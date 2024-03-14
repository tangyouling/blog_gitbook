<span id="hidden-autonumber"></span>

<h1 class="article-title">系统关机时长时间卡在swapoff过程</h1>

# 1 环境
- 海光服务器
- 麒麟sp1系统
- 4.19内核

# 2 问题现象
系统关机过程耗时很长，时间主要花费在swapoff过程中，串口显示如下内核日志：
```
Failed deactivating swap /dev/mapper/roottvg-lv_swap.
```
这句打印来自于systemd中，
```
https://github.com/systemd/systemd.git
src/core/swap.c
```

# 3 问题原因
## 3.1 初步怀疑
- systemd是否存在bug？
- 是否内核swapoff回收机制存在一定的问题？

## 3.2 确定问题是在用户态还是内核态

### 3.2.1 构建测试用例
主要测试原理：通过构建用户态测试用例，首先分配空间耗尽内存，然后再分配空间将使用到swap空间，接着再通过`strace`追踪`swapoff`命令来查看具体相关系统调用的执行时间。

test.c去耗尽可用内存
```c
#include <stdio.h>
#include <stdlib.h>
#include <unistd.h>
#include <string.h>

int main(void)
{
        char *p;
        int i;

        /* 自行调整，尽量把可用内存耗完（但还未开始使用swap）*/
        for (i=0; i<6; i++)
        {
                p=malloc(1024 * 1024 * 1024);
                memset(p, i, 1024*1024*1024);
        }

        sleep (10000);
}
```

test1.c 使用swap空间。
```c
int main(void)
{
        char *p;
        int i;

        for (i=0; i<1024; i++)
        {
                p=malloc(1024 * 1024);
                memset(p, i, 1024*1024);
        }

        sleep (1);
}
```

### 3.2.2 执行用户态测试用例
编译执行：   
$ gcc test.c -o test    
$ gcc test1.c -o test1   

使用free观察内存差不多耗完，然后再执行test1。   
$ ./test &   
$ ./test1   

执行完之后类似如下：
```sh
[root@localhost ~]# free -lh
              total        used        free      shared  buff/cache   available
Mem:          6.5Gi       5.3Gi       1.1Gi       3.0Mi        96Mi       1.0Gi
Low:          6.5Gi       5.4Gi       1.1Gi
High:            0B          0B          0B
Swap:         2.0Gi       1.0Gi       1.0Gi
```

### 3.2.3 strace追踪swapoff
```sh
# 执行如下命令
$ sudo strace -T swapoff -a
...
# 可观察到大部分时间都耗在swapoff系统调用
swapoff("/dev/dm-1")                    = 0 <124.085368>
```
所以可以基本确定，问题是出在**内核swapoff**相关实现。

## 3.3 perf追踪内核调用关系和执行时间
```sh
# -p 为指定的进程号，即前面执行 `swapoff -a` 命令的进程号
# 会在当前目录下生成perf.data文件
$ sudo perf record -g -p 13934

# 通过perf script可以看调用关系
$ sudo perf script

# 通过perf report查看具体调用关系和各函数执行时间占比
$ sudo perf report
-   99.97%     0.00%  swapoff  [kernel.kallsyms]  [k] entry_SYSCALL_64_after_hwframe                 ▒
     entry_SYSCALL_64_after_hwframe                                                                  ▒
     do_syscall_64                                                                                   ▒
     __do_sys_swapoff                                                                                ◆
   - try_to_unuse                                                                                    ▒
      - 96.67% unuse_mm                                                                              ▒
         - 95.25% unuse_p4d_range                                                                    ▒
            + 3.96% _cond_resched                                                                    ▒
            + 0.61% apic_timer_interrupt                                                             ▒
      + 2.15% read_swap_cache_async                                                                  ▒
      + 0.65% wait_on_page_bit                                                                       ▒
-   99.97%     0.00%  swapoff  [kernel.kallsyms]  [k] do_syscall_64                                  ▒
     do_syscall_64                                                                                   ▒
     __do_sys_swapoff                                                                                ▒
   - try_to_unuse                                                                                    ▒
      - 96.67% unuse_mm                                                                              ▒
         - 95.25% unuse_p4d_range                                                                    ▒
            + 3.96% _cond_resched                                                                    ▒
            + 0.61% apic_timer_interrupt                                                             ▒
      + 2.15% read_swap_cache_async                                                                  ▒
      + 0.65% wait_on_page_bit                                                                       ▒
-   99.97%     0.00%  swapoff  [kernel.kallsyms]  [k] __do_sys_swapoff                               ▒
     __do_sys_swapoff                                                                                ▒
   - try_to_unuse                                                                                    ▒
      - 96.67% unuse_mm                                                                              ▒
         - 95.25% unuse_p4d_range                                                                    ▒
            + 3.96% _cond_resched                                                                    ▒
            + 0.61% apic_timer_interrupt                                                             ▒
      + 2.15% read_swap_cache_async                                                                  ▒
      + 0.65% wait_on_page_bit                                                                       ▒
+   99.97%     0.08%  swapoff  [kernel.kallsyms]  [k] try_to_unuse                                   ▒
+   96.67%     1.08%  swapoff  [kernel.kallsyms]  [k] unuse_mm                                       ▒
-   95.25%    90.35%  swapoff  [kernel.kallsyms]  [k] unuse_p4d_range                                ▒
   - 90.35% swapoff                                                                                  ▒
        entry_SYSCALL_64_after_hwframe                                                               ▒
        do_syscall_64                                                                                ▒
        __do_sys_swapoff                                                                             ▒
        try_to_unuse                                                                                 ▒
        unuse_mm                                                                                     ▒
        unuse_p4d_range                                                                              ▒
   - 4.90% unuse_p4d_range                                                                           ▒
      + 3.96% _cond_resched                                                                          ▒
      + 0.61% apic_timer_interrupt              


       │35f:   add    0x10d1dda(%rip),%rdx                                                           ▒
  0.03 │       and    %rcx,%rax                                                                      ▒
  0.00 │       add    %rdx,%rax                                                                      ▒
  0.05 │     ↓ jmp    382                                                                            ▒
 57.47 │36e:   add    $0x1000,%r15                                                                   ▒
  0.14 │       add    $0x8,%rax                                                                      ▒
  0.03 │       cmp    %r15,%rbx                                                                      ▒
  0.08 │     ↑ je     28b                                                                            ▒
  0.47 │382:   mov    (%rax),%rdx                                                                    ▒
 38.32 │       and    $0xfffffffffffffffd,%rdx                                                       ▒
  0.07 │       cmp    %rdx,%r14                                                                      ▒
  0.26 │     ↑ jne    36e   
```
由上述可知，百分之九十以上时间耗在了 **`unuse_p4d_range`** 。   
后续将重点关注这部分流程。

# 4 解决办法
通过查看上游，发现了一些优化补丁：   
```
1）应用c5bf121e4350a933bd431385e6fcb72a898ecc68
2）b56a2d8af9147a4efe4011b60d93779c0461ca97
应用如上2个补丁，速度由10M/s提升到30M/s：
 Swap:         2.0Gi       1.0Gi       1.0Gi
 swapoff("/dev/dm-1")                    = 0 <36.595077>

3）应用    ebc5951eea499314f6fbbde20e295f1345c67330
应用如上补丁，速度由30M/s提升到接近100M/s：
Swap:         2.0Gi       1.0Gi       992Mi
swapoff("/dev/dm-1")                    = 0 <12.977927>
swapoff("/dev/dm-1")                    = 0 <12.096080>
```

Patch links:
- [mm: refactor swap-in logic out of shmem_getpage_gfp](https://git.kernel.org/pub/scm/linux/kernel/git/torvalds/linux.git/commit/?id=c5bf121e4350a933bd431385e6fcb72a898ecc68)
- [mm: rid swapoff of quadratic complexity](https://git.kernel.org/pub/scm/linux/kernel/git/torvalds/linux.git/commit/?id=b56a2d8af9147a4efe4011b60d93779c0461ca97)
- [mm: swap: properly update readahead statistics in unuse_pte_range()](https://git.kernel.org/pub/scm/linux/kernel/git/torvalds/linux.git/commit/?id=ebc5951eea499314f6fbbde20e295f1345c67330)
