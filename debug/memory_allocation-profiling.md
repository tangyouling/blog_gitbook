<span id="hidden-autonumber"></span>

<h1 class="article-title">内存分配剖析 -- Memory allocation profiling</h1>

# 1 译《allocation-profiling.rst》

原文：[allocation-profiling.rst](https://www.kernel.org/doc/Documentation/mm/allocation-profiling.rst)

## 1.1 内存分配剖析

低开销(适用于生产)，记录所有内存分配，按文件和行号跟踪。

用法：

Kconfig 选项：

- CONFIG_MEM_ALLOC_PROFILING
- CONFIG_MEM_ALLOC_PROFILING_ENABLED_BY_DEFAULT
- CONFIG_MEM_ALLOC_PROFILING_DEBUG

启动参数：

```
sysctl.vm.mem_profiling=0|1|never
```

当设置为“never”时，内存分配分析开销最小化，并且不能在运行时启用(sysctl变为只读)。

当CONFIG_MEM_ALLOC_PROFILING_ENABLED_BY_DEFAULT=y时，默认值为”1“。

当CONFIG_MEM_ALLOC_PROFILING_ENABLED_BY_DEFAULT=n时，默认值为“never”。

sysctl:

```
/proc/sys/vm/mem_profiling
```

运行时信息：

```
/proc/allocinfo
```

示例输出：

```
  root@moria-kvm:~# sort -g /proc/allocinfo|tail|numfmt --to=iec
        2.8M    22648 fs/kernfs/dir.c:615 func:__kernfs_new_node
        3.8M      953 mm/memory.c:4214 func:alloc_anon_folio
        4.0M     1010 drivers/staging/ctagmod/ctagmod.c:20 [ctagmod] func:ctagmod_start
        4.1M        4 net/netfilter/nf_conntrack_core.c:2567 func:nf_ct_alloc_hashtable
        6.0M     1532 mm/filemap.c:1919 func:__filemap_get_folio
        8.8M     2785 kernel/fork.c:307 func:alloc_thread_stack_node
         13M      234 block/blk-mq.c:3421 func:blk_mq_alloc_rqs
         14M     3520 mm/mm_init.c:2530 func:alloc_large_system_hash
         15M     3656 mm/readahead.c:247 func:page_cache_ra_unbounded
         55M     4887 mm/slub.c:2259 func:alloc_slab_page
        122M    31168 mm/page_ext.c:270 func:alloc_page_ext
```

## 1.2 操作理论

内存分配剖析建立在代码标记（code tagging）的基础上，代码标记是一个库，用于声明静态结构(通常以某种方式描述文件和行号，因此是代码标记)，然后在运行时查找和操作它们。

- 迭代它们，在debugfs/procfs中打印。

记录分配调用，我们将其替换为宏调用`alloc_hooks()`，该宏调用

- 声明一个代码标记
- 在task_struct中存储指向它的指针`alloc_tag`
- 调用真正的分配函数
- 最后，将task_struct 中 `alloc_tag`指针恢复到其先前的值。

这允许嵌套alloc_hooks()调用，并使最近的调用生效。这对于mm/代码内部的分配很重要，这些分配不属于外部分配上下文，应该单独计算：例如，slab对象扩展向量，或者当slab从页面分配器分配页面时。

因此，正确的使用需要确定分配调用堆栈中的哪个函数应该被标记。有许多辅助函数本质上是包装的，例如kmalloc()，并做一些更多的工作，然后在多个地方调用;我们通常希望accounting发生在这些helper的调用者中，而不是在helper本身中。

去修复给定的helper，例如foo()，执行以下操作:

- 将其分配调用切换到_noprof()版本，例如kmalloc_noprof()

- 重命名为foo_noprof()

- 定义foo()的宏版本，如下所示:

  ```c
  #define foo(...) alloc_hooks(foo_noprof(__VA_ARGS__))
  ```

也可以在自己的数据结构中隐藏一个指向alloc标记的指针。

当想要实现“代表(on behalf of)”其他代码(例如，rashtable代码)进行分配的通用数据结构时，请执行此操作。这样，我们就不用在/proc/allocinfo中看到rhashtable.c的一大行，而是可以按rashtable类型将它分开。

这样做：

- Hook数据结构的init函数，就像其他分配函数一样。

- 在init函数中，使宏alloc_tag_record()在数据结构中记录alloc_tag。

- 然后，使用以下表格进行分配：

  ```c
  alloc_hooks_tag(ht->your_saved_tag, kmalloc_noprof(...))
  ```

补丁链接：

[LWN: Memory allocation profiling](https://lwn.net/Articles/964630/)

# 2 操作实例

## 2.1 以xfs的xfs_uuid_table分配为例

### 2.1.1 制作xfs挂载镜像

xfs_uuid_table在xfs_uuid_mount()中通过krealloc()分配。

```sh 
# 制作xfs挂载镜像1
$ xfs_io -f -c "falloc 0 10g" test.img
$ mkfs.xfs ./test.img
$ sudo losetup /dev/loop5 ./test.img

# 制作xfs挂载镜像2
$ xfs_io -f -c "falloc 0 10g" test2.img
$ mkfs.xfs ./test2.img
$ sudo losetup /dev/loop6 ./test2.img
```

### 2.1.2 两次挂载后allocinfo变化

然后观察mount前后的xfs相关内存分配变化。

```sh 
# 挂载loop5
$ sudo mount /dev/loop5 /mnt/xfs

# 截取allocinfo中xfs部分内容
$ sudo sort -g /proc/allocinfo | grep -w xfs
allocinfo - version: 1.0
#     <size>  <calls> <tag info>
          16        1 fs/xfs/xfs_mount.c:87 [xfs] func:xfs_uuid_mount 
          40        1 fs/xfs/xfs_log_cil.c:1775 [xfs] func:xlog_cil_init 
```

从上可以看到，在xfs_uuid_mount中分配了1次，大小为16字节。

```c
  44 void
  45 xfs_uuid_table_free(void)
  46 {
  ...
  86         if (hole < 0) {
  87                 xfs_uuid_table = krealloc(xfs_uuid_table,
  88                         (xfs_uuid_table_size + 1) * sizeof(*xfs_uuid_table),
  89                         GFP_KERNEL | __GFP_NOFAIL);
  90                 hole = xfs_uuid_table_size++;
  91         }
```

可以看出allocinfo中的内容和代码是能匹配上的。

再挂载镜像loop6：

```sh 
# 挂载loop5
$ sudo mount /dev/loop6 /mnt/xfs

# 截取allocinfo中xfs部分内容
$ sudo sort -g /proc/allocinfo | grep -w xfs
allocinfo - version: 1.0
#     <size>  <calls> <tag info>
          32        1 fs/xfs/xfs_mount.c:87 [xfs] func:xfs_uuid_mount 
          80        2 fs/xfs/xfs_log_cil.c:1775 [xfs] func:xlog_cil_init 
```

从上可以看出，第二次挂载时，size翻倍了，而第一行的calls还是1次，而第二行的calls变为了2。

疑问1：为什么xfs_uuid_table分配位置调用次数还为1？

### 2.1.3 卸载后allocinfo变化

```sh
# 卸载/mnt/xfs
$ sudo mount /dev/loop6 /mnt/xfs

# 截取allocinfo中xfs部分内容
$ sudo sort -g /proc/allocinfo | grep -w xfs
allocinfo - version: 1.0
#     <size>  <calls> <tag info>
          32        1 fs/xfs/xfs_mount.c:87 [xfs] func:xfs_uuid_mount 
          40        1 fs/xfs/xfs_log_cil.c:1775 [xfs] func:xlog_cil_init 
```

可以看到第二行的size和calls都减半，符合预期结果，但第一行确没什么变化（xfs_uuid_table）。

````sh 
# 卸载/mnt/xfs2
$ sudo mount /dev/loop6 /mnt/xfs

# 截取allocinfo中xfs部分内容
$ sudo sort -g /proc/allocinfo | grep -w xfs
allocinfo - version: 1.0
#     <size>  <calls> <tag info>
          32        1 fs/xfs/xfs_mount.c:87 [xfs] func:xfs_uuid_mount 
           0        0 fs/xfs/xfs_log_cil.c:1775 [xfs] func:xlog_cil_init 
````

可以看到第二行都变为0,恢复到最初始状态，而第一行还是没有什么变化。

所有xfs挂载镜像都卸载后，只有两个没有恢复到0：

```sh
32         1 fs/xfs/xfs_mount.c:87 [xfs] func:xfs_uuid_mount
912        1 fs/xfs/xfs_super.c:2395 [xfs] func:init_xfs_fs 
```

原因是这两个分配内存对应的释放操作是在exit_xfs_fs()中，仅当xfs模块卸载后，才后被执行。

疑问2：为什么xfs_uuid_table_free()释放操作没放到xfs_uuid_unmount()中？

## 2.2 为什么xfs_uuid_table分配位置调用次数还为1

次数为什么一直为1和krealloc() API有关，其它大部分函数，分配调用的次数和当前代码执行的此时是能对应上的（在未执行释放操作前）。

```c
// 用于重新为让p执行一段新申请的内存，但是保持p指针指向内存中的内容不变
// 通俗讲就是为p重新申请一段内存，再将p之前内存中的内容复制过来.
void *krealloc_noprof(const void *p, size_t new_size, gfp_t flags)
{
        void *ret;

        if (unlikely(!new_size)) {
                //新申请的内存为null的话，则不但不申请新的内存还会释放p之前指向的老的内存
                kfree(p);
                return ZERO_SIZE_PTR;
        }

        ret = __do_krealloc(p, new_size, flags);
        if (ret && kasan_reset_tag(p) != kasan_reset_tag(ret))
                kfree(p);

        return ret;
}
EXPORT_SYMBOL(krealloc_noprof);
```

从代码中可以看到，旧空间会被释放，将重新一次性分配size大小的新空间，并把旧内容拷贝到新空间中。所以allocinfo中的size就是一次分配出的，从而calls显示为1是正确的。

## 2.3 为什么xfs_uuid_table_free()释放操作没放到xfs_uuid_unmount()中

最开始认为xfs_uuid_table_free()应该放在xfs_uuid_unmount()中，这样umount操作之后，xfs_uuid_table内存就会被释放。但如果挂载了多个xfs设备时，第一次umount就会把整个xfs_uuid_table释放掉，这样是错误的。所以将xfs_uuid_table_free()放在exit_xfs_fs()是正确的。
