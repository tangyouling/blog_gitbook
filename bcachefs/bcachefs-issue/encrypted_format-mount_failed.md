<span id="hidden-autonumber"></span>

<h1 class="article-title">加密格式化后挂载失败</h1>

# 1 环境
- ubuntu 22.04lts
- 6.9.0-rc2+内核（从支持bcachefs开始，这现象就存在）

# 2 问题现象
使用`encrypted`特性格式化磁盘：
```sh
sudo ./bcachefs format  --encrypted /dev/sda
```
挂载该磁盘：
```sh
sudo mount -t bcachefs /dev/sda /mnt/
```

显示挂载失败：

```
$ sudo mount -t bcachefs /dev/sda /mnt/
mount: /mnt: mount(2) system call failed: Required key not available.

# dmesg
[  312.672292] bcachefs (13fcc4fe-893c-4d5a-9c28-828b47f687c1): error requesting encryption key : ENOKEY
```

可以看出挂载失败是由于请求密钥key失败导致的，内核返回错误码-126（ENOKEY）。

该问题在官方仓库已经有人提交了issues进行反馈：

[Fatal error: Required key not available](https://github.com/koverstreet/bcachefs/issues/640)

# 3 问题原因

## 3.1 bcachefs-tools代码分析
### 3.1.1 `cmd_format分析`

在`c_src/cmd_format.c`文件中，是`bcachefs format`命令的实现，该命令入口函数为`cmd_format()`。

官方释义：

```
--encrypted             Enable whole filesystem encryption (chacha20/poly1305)
--no_passphrase         Don't encrypt master encryption key
```

如果加了`--encrypted`但未加`--no_passphrase`参数，则会输入两次密码，并记录到`opts.passphrase`中。

### 3.1.2 `cmd_unlock`分析

在`c_src/cmd_key.c`文件中，是`bcachefs unlock`命令的实现，该命令入口函数为`cmd_unlock()`。

官方释义（主要关注-k参数）：

```
-k (session|user|user_session)
                         Keyring to add to (default: user)
```

通过注释和代码来看，可以看出默认的keyring是`user`，通过`bch2_add_key()`进行添加。

通过-k指定的不同，在bch2_add_key进行相应处理，转换为不同的keyring，分别是`KEY_SPEC_SESSION_KEYRING`、`KEY_SPEC_USER_KEYRING`和`KEY_SPEC_USER_SESSION_KEYRING`。然后通过`add_key`系统调用进入内核进行相应的处理。

## 3.2 linux内核代码分析

### 3.2.1 dmesg中错误日志来源

打印来自于`fs/bcachefs/checksum.c`中的`bch2_decrypt_sb_key()`函数。

```c
int bch2_decrypt_sb_key(struct bch_fs *c,
                        struct bch_sb_field_crypt *crypt,
                        struct bch_key *key)
{
...        
        ret = bch2_request_key(c->disk_sb.sb, &user_key);
        if (ret) {
                bch_err(c, "error requesting encryption key : %s", bch2_err_str(ret));
                goto err;
        }
...
}
```

### 3.2.2 bch2_decrypt_sb_key分析

调用关系：

```
bch2_decrypt_sb_key
	bch2_request_key
		__bch2_request_key //对于内核，走的是__KERNEL__包含的定义
			request_key(&key_type_user, key_description, NULL) //对于内核，走的非系统调用的定义
				request_key_tag
					request_key_and_link //key = ERR_PTR(-ENOKEY);
						search_process_keyrings_rcu //其key_ref是ERR_PTR(-ENOKEY)
```

从代码执行来看，是执行`request_key_and_link()`返回了ENOKEY，从而导致bch2_decrypt_sb_key执行失败并打印错误信息。而失败的原因是没有搜索到需要的keyring。

此处的`key_description`中内容是`bcachefs:13fcc4fe-893c-4d5a-9c28-828b47f687c1`。

## 3.3 bcachefs unlock -k方式添加keyring

### 3.3.1 add_key实现

在内核`security/keys/keyctl.c`中，定义了`SYSCALL_DEFINE5(add_key`。

调用关系：

```
add_key
	lookup_user_key
		case KEY_SPEC_SESSION_KEYRING:
		case KEY_SPEC_USER_KEYRING:
		case KEY_SPEC_USER_SESSION_KEYRING:
	key_create_or_update
		__key_create_or_update
			key_alloc
			__key_instantiate_and_link
```

在lookup_user_key中处理不同类型的key。

### 3.3.2 key操作命令

```sh
# 查看初始状态下的keyring
$ sudo keyctl show
Session Keyring
 835650386 --alswrv   1000  1000  keyring: _ses

# 通过bcachefs unlock创建user类型(KEY_SPEC_USER_KEYRING)的keyring
$ sudo bcachefs unlock -k user /dev/sda 
Enter passphrase: 

# 该Session Keyring中并没有新加显示
$ sudo keyctl show
Session Keyring
 835650386 --alswrv   1000  1000  keyring: _ses

# 将user类型的link到session中
$ sudo keyctl link @u @s

# 可以看到新增加了bcachefs的keyring
$ sudo keyctl show
Session Keyring
 835650386 --alswrv   1000  1000  keyring: _ses
 203633021 --alswrv      0 65534   \_ keyring: _uid.0
 880346407 --alswrv      0     0       \_ user: bcachefs:13fcc4fe-893c-4d5a-9c28-828b47f687c1

# 然后就可以成功挂载，因为可以成功找到keyring
$ sudo mount -t bcachefs /dev/sda /mnt/
```

接着删除keyring，然后直接创建session类型的。

```sh
# 卸载该磁盘
$ sudo umount /dev/sda

# 清除之前添加的keyring
$ sudo keyctl clear 835650386

# 回到了最初始的状态
$ sudo keyctl show
Session Keyring
 835650386 --alswrv   1000  1000  keyring: _ses
 
# 此时去挂载就会失败 
$ sudo mount -t bcachefs /dev/sda /mnt/
mount: /mnt: mount(2) system call failed: Required key not available.

# 通过bcachefs unlock创建session类型(KEY_SPEC_SESSION_KEYRING)的keyring
$ sudo bcachefs unlock -k session /dev/sda
Enter passphrase: 

# 这样不用通过keyctl link命令操作，可以看到keyring被直接添加到了下面
$ sudo keyctl show
Session Keyring
 835650386 --alswrv   1000  1000  keyring: _ses
 753739685 --alswrv      0     0   \_ user: bcachefs:13fcc4fe-893c-4d5a-9c28-828b47f687c1
 
# 然后就可以成功挂载，因为可以成功找到keyring
$ sudo mount -t bcachefs /dev/sda /mnt/ 
```

通过man手册查看keyctl对这三种keyring的解释：

```
Session keyring: @s or -3
       Each  process  subscribes to a session keyring that is inherited across (v)fork, exec
       and clone. This is searched after the process keyring. Session keyrings can be  named
       and an extant keyring can be joined in place of a process's current session keyring.

User specific keyring: @u or -4
       This keyring is shared between all the processes owned by a particular user. It isn't
       searched directly, but is normally linked to from the session keyring.

User default session keyring: @us or -5
       This is the default session keyring for  a  particular  user.  Login  processes  that
       change to a particular user will bind to this session until another session is set.
```

其中`Session keyring`中有`This is searched after the process keyring`。

而`User specific keyring`中是`It isn't searched directly`。这可能是默认user类型下不能被搜索到（以及显示），从而失败的原因。

# 4 解决办法

办法一（通过keyctl link方式）：

```sh
sudo bcachefs format  --encrypted /dev/sda
sudo keyctl link @u @s
sudo bcachefs unlock -k user /dev/sda
sudo mount -t bcachefs /dev/sda /mnt/
```

方法二（创建session类型）：

```sh
sudo bcachefs format  --encrypted /dev/sda
sudo bcachefs unlock -k session /dev/sda
sudo mount -t bcachefs /dev/sda /mnt/
```
