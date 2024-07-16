<span id="hidden-autonumber"></span>

<h1 class="article-title">list_lru_add 空指针解引用（bcachefs增加SLAB_ACCOUNT标记后）</h1>

# 1 问题来源

引入问题commit: [86d81ec5f5f05846c7c6e48ffb964b24cba2e669](https://git.kernel.org/pub/scm/linux/kernel/git/torvalds/linux.git/commit/?id=86d81ec5f5f05846c7c6e48ffb964b24cba2e669)

问题讨论：[[PATCH] bcachefs: Mark bch_inode_info as SLAB_ACCOUNT](https://lore.kernel.org/linux-bcachefs/84de6cb1-57bd-42f7-8029-4203820ef0b4@linux.dev/T/#m901bb26cdb1d9d4bacebf0d034f0a5a712cc93a6)

# 2 问题现象

开启MEMCG配置后，测试xfstest的generic/001就可以复现该问题，在文件系统shutdown时进入到bch2_kill_sb后的list_lru_add路径时，就会触发空指针解引用异常。

```
BUG: kernel NULL pointer dereference, address: 0000000000000008
#PF: supervisor read access in kernel mode
#PF: error_code(0x0000) - not-present page
PGD 0 P4D 0
Oops: Oops: 0000 [#1] SMP
CPU: 5 PID: 1702 Comm: umount Not tainted 
6.10.0-rc7-ktest-00003-g557bd05b0d4c-dirty #12
Hardware name: QEMU Standard PC (Q35 + ICH9, 2009), BIOS 1.15.0-1 04/01/2014
RIP: 0010:list_lru_add+0x83/0x100
Code: 5f 5d c3 48 8b 45 d0 48 85 c0 74 13 41 80 7c 24 1c 00 48 63 b0 68 
06 00 00 74 04 85 f6 79 5e 4d 03 2c 24 49 83 c5 08 4c 89 ea <49> 8b 45 
08 49 89 5d 08 48 89 13 48 89 43 08 48 89 18 49 8b 45 10
RSP: 0018:ffff8881178efd10 EFLAGS: 00010246
RAX: 0000000000000000 RBX: ffff88810ec140f0 RCX: 0000000000000000
RDX: 0000000000000000 RSI: 0000000000000017 RDI: ffff8881178efcc8
RBP: ffff8881178efd48 R08: ffff8881009de780 R09: ffffffff822e0de0
R10: 0000000000000000 R11: 0000000000000000 R12: ffff888102075c80
R13: 0000000000000000 R14: ffff88810443e6c0 R15: 0000000000000000
FS:  00007f9ed1840800(0000) GS:ffff888179940000(0000) knlGS:0000000000000000
CS:  0010 DS: 0000 ES: 0000 CR0: 0000000080050033
CR2: 0000000000000008 CR3: 00000001062b9005 CR4: 0000000000370eb0
DR0: 0000000000000000 DR1: 0000000000000000 DR2: 0000000000000000
DR3: 0000000000000000 DR6: 00000000fffe0ff0 DR7: 0000000000000400

Call Trace:
  <TASK>
  ? show_regs+0x69/0x70
  ? __die+0x29/0x70
  ? page_fault_oops+0x14f/0x3c0
  ? do_user_addr_fault+0x2d0/0x5b0
  ? default_wake_function+0x1e/0x30
  ? exc_page_fault+0x6d/0x130
  ? asm_exc_page_fault+0x2b/0x30
  ? list_lru_add+0x83/0x100
  list_lru_add_obj+0x4b/0x60
  iput+0x1fe/0x220
  dentry_unlink_inode+0xbd/0x120
  __dentry_kill+0x78/0x180
  dput+0xc7/0x170
  shrink_dcache_for_umount+0xe8/0x120
  generic_shutdown_super+0x23/0x150
  bch2_kill_sb+0x1b/0x30
  deactivate_locked_super+0x34/0xb0
  deactivate_super+0x44/0x50
  cleanup_mnt+0x105/0x160
  __cleanup_mnt+0x16/0x20
  task_work_run+0x63/0x90
  syscall_exit_to_user_mode+0x10d/0x110
  do_syscall_64+0x57/0x100
  entry_SYSCALL_64_after_hwframe+0x4b/0x53
RIP: 0033:0x7f9ed1a7a6e7
Code: 0c 00 f7 d8 64 89 02 b8 ff ff ff ff c3 66 0f 1f 44 00 00 31 f6 e9 
09 00 00 00 66 0f 1f 84 00 00 00 00 00 b8 a6 00 00 00 0f 05 <48> 3d 00 
f0 ff ff 77 01 c3 48 8b 15 09 97 0c 00 f7 d8 64 89 02 b8
RSP: 002b:00007ffef8a29128 EFLAGS: 00000246 ORIG_RAX: 00000000000000a6
RAX: 0000000000000000 RBX: 000055f4671acad8 RCX: 00007f9ed1a7a6e7
RDX: 0000000000000000 RSI: 0000000000000000 RDI: 000055f4671b1240
RBP: 0000000000000000 R08: 0000000000000001 R09: 0000000000000000
R10: 0000000000000000 R11: 0000000000000246 R12: 00007f9ed1bc6244
R13: 000055f4671b1240 R14: 000055f4671acde0 R15: 000055f4671ac9d0
  </TASK>
```

# 3 直接现象分析

```c
bool list_lru_add(struct list_lru *lru, struct list_head *item, int nid,
                    struct mem_cgroup *memcg)
{
        struct list_lru_node *nlru = &lru->node[nid];
        struct list_lru_one *l;

        spin_lock(&nlru->lock);
        if (list_empty(item)) {
                l = list_lru_from_memcg_idx(lru, nid, memcg_kmem_id(memcg));

                list_add_tail(item, &l->list);
                /* Set shrinker bit if the first element was added */
                if (!l->nr_items++)
                        set_shrinker_bit(memcg, nid, lru_shrinker_id(lru));
                nlru->nr_items++;
                spin_unlock(&nlru->lock);
                return true;
        }
        spin_unlock(&nlru->lock);
        return false;
}
EXPORT_SYMBOL_GPL(list_lru_add);
```

由上述的calltrace可知，问题是访问`l (list_lru_one)`成员时出现了空指针解引用，原因是`list_lru_from_memcg_idx()`的返回的l为NULL。

# 4 初步解决方案

因为list_lru_from_memcg_idx的返回值li可能为NULL，在对l行访问时，应该先判断l是否为NULL，如果为NULL，应该进行相应的错误处理。

[[PATCH] mm: list_lru: Fix NULL pointer dereference in list_lru_add()](https://lore.kernel.org/all/20240712032554.444823-1-youling.tang@linux.dev/)

```diff
diff --git a/mm/list_lru.c b/mm/list_lru.c
index 3fd64736bc45..ee7424c3879d 100644
--- a/mm/list_lru.c
+++ b/mm/list_lru.c
@@ -94,6 +94,9 @@ bool list_lru_add(struct list_lru *lru, struct list_head *item, int nid,
 	spin_lock(&nlru->lock);
 	if (list_empty(item)) {
 		l = list_lru_from_memcg_idx(lru, nid, memcg_kmem_id(memcg));
+		if (!l)
+			goto out;
+
 		list_add_tail(item, &l->list);
 		/* Set shrinker bit if the first element was added */
 		if (!l->nr_items++)
@@ -102,6 +105,7 @@ bool list_lru_add(struct list_lru *lru, struct list_head *item, int nid,
 		spin_unlock(&nlru->lock);
 		return true;
 	}
+out:
 	spin_unlock(&nlru->lock);
 	return false;
 }
```

应用如上patch之后，测试能通过。

但这补丁其实并没有解决问题根本，只是把bug隐藏了起来，至于为什么在bcachefs增加SLAB_ACCOUNT标记之后，开启MEMCG时，list_lru_from_memcg_idx会返回NULL这个原因并不清楚。

# 5 根本解决方案

## 5.1 问题原因猜想

出现空指针解引用原因

- 释放后再引用？
- 本身就未分配，后续又去使用？

因为其它文件系统都正常，就bcachefs出现了问题，所以更倾向于未分配而使用

## 5.2 函数调用分析

整个流程就是发生在fs->kill_sb时，去回收dcache，然后再释放dentry和inode。但在释放inode时，该superblock还存在于系统中(sb->s_flags & SB_ACTIVE)，则需要将这inode添加到lru (unused)链表中，在将iitem添加到lru列表中过程中，最终因为list_lru_one为NULL，对list_lru_one成员访问而触发BUG。

```c
cleanup_mnt
	deactivate_super
		deactivate_locked_super //drop superblock的active引用，即对super_block中的s_active成员减1
			bch2_kill_sb //fs->kill_sb
    			generic_shutdown_super
					shrink_dcache_for_umount //umount时销毁superblock上的dentry
    					do_one_tree
    
do_one_tree
    d_put //释放一个dentry
    	__dentry_kill
    		dentry_unlink_inode //释放dentry的inode
    			iput //put这inode，如果这inode的i_count减到了0，则调用iput_final释放这inode
    				iput_final //删除inode的最后一个引用才调用

iput_final 
    __inode_add_lru //因为superblock还存在在系统中，将这inode添加到lru (unused)链表
    	list_lru_add_obj(struct list_lru *lru, struct list_head *item)
    		list_lru_add
    			list_lru_from_memcg_idx //返回了NULL
```

dcache和icache参考[inode缓存与dentry缓存](https://www.cnblogs.com/long123king/p/3536486.html)。

## 5.3 梳理list_lru_one相关结构分配

通过社区交流得知，list_lru_one将在inode/dentry等分配路径中预分配，因为是在将inode添加到lru中时出了问题，所以从分配inde路径着手，是在哪对list_lru_one进行了分配？

dentry和super_block中和lru相关的成员：

```c
struct dentry {
        union {
                struct list_head d_lru;         /* LRU list */
                wait_queue_head_t *d_wait;      /* in-lookup ones only */
        };
}

struct super_block {
		/*
         * The list_lru structure is essentially just a pointer to a table
         * of per-node lru lists, each of which has its own spinlock.
         * There is no need to put them into separate cachelines.
         */
        struct list_lru         s_dentry_lru;
        struct list_lru         s_inode_lru;
}


// 把dentry->d_lru添加到super_block中的s_dentry_lru中
static void d_lru_add(struct dentry *dentry)
```

### 5.3.1 bcachefs中inode分配

bcachefs分配inode和其它文件系统有点不一样。其它文件系统分配inode使用的alloc_inode方法（eg: ext4_alloc_inode）,而bcachefs的bch2_alloc_inode实现为BUG，不会去走该路径，而是走bch2_new_inode --> __bch2_new_inoded等路径，将在`__bch2_new_inode`中去分配inode（bch_inode_info）。

对比发现，其它文件系统都使用的alloc_inode_sb从inode cache池中分配，但bcachefs是使用kmem_cache_alloc从缓存池分配。

### 5.3.2 alloc_inode_sb和kmem_cache_alloc区别

alloc_inode_sb实际就是调用的kmem_cache_alloc_lru，而kmem_cache_alloc_lru和kmem_cache_alloc区别就是在调用slab_alloc_node时传入的lru参数，如果是kmem_cache_alloc，则lru参数为NULL。

kmem_cache_alloc_lru部分调用如下：

```c
kmem_cache_alloc_lru
	kmem_cache_alloc_lru_noprof
		slab_alloc_node
			slab_post_alloc_hook
				memcg_slab_post_alloc_hook
					__memcg_slab_post_alloc_hook
    					memcg_list_lru_alloc			
```

当lru参数为NULL，最终将不会去分配list_lru_one相关结构，从而list_lru_from_memcg_idx通过memcg idx去获取list_lru_one而为NULL。

## 5.4 修复补丁

所以解决方案就是改为alloc_inode_sb从缓存池中去分配inode。

[[PATCH] bcachefs: allocate inode by using alloc_inode_sb()](https://lore.kernel.org/all/20240716025816.52156-1-youling.tang@linux.dev/)

```diff
diff --git a/fs/bcachefs/fs.c b/fs/bcachefs/fs.c
index f9c9a95d7d4c..34649ed2e3a1 100644
--- a/fs/bcachefs/fs.c
+++ b/fs/bcachefs/fs.c
@@ -227,7 +227,8 @@ static struct inode *bch2_alloc_inode(struct super_block *sb)
 
 static struct bch_inode_info *__bch2_new_inode(struct bch_fs *c)
 {
-	struct bch_inode_info *inode = kmem_cache_alloc(bch2_inode_cache, GFP_NOFS);
+	struct bch_inode_info *inode = alloc_inode_sb(c->vfs_sb,
+						bch2_inode_cache, GFP_NOFS);
 	if (!inode)
 		return NULL;
```
