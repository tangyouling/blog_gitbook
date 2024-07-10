# <center>ketones工具分析</center>

[TOC]

工具项目地址：https://gitee.com/openkylin/ketones/tree/master/

## 1. 历史背景

随着BPF技术发展，开发一个BPF程序变得越来越简单，但可移植性还是存在一定困难。目前社区致力于使用BTF和libbpf来达到CO-RE的效果，去解决该问题。ketones项目正是基于了该技术。

## 2. 依赖技术简介

### 2.1 BPF CO-RE技术

当前BPF的移植存在如下两个挑战：

- 不同内核版本数据的内存布局不同；
-  内核类型和数据结构不断变化，结构体字段可能被移除或重命名。

而BPF CO-RE（Compile Once-Run Everywhere）是编写可移植 BPF 应用程序的一种现代方法，它可以在多个内核版本和配置上运行，无需在目标机器上进行修改和运行时编译源代码，即一次编译，任何地方运行的效果。

为了支持CO-RE，提供了以下组件：

- BTF：描述内核镜像，获取内核及BPF程序类型和代码的关键信息;

- Clang释放bpf重定位信息到.btf段;

- libbpf CO-RE根据.btf段重定位bpf程序。

为了获取正确的信息内容，需要进行重定位的信息主要有三类：

- 结构体相关重定位，这部分和BTF息息相关，主要是通过CO-RE-relocatable。

  CO-RE-relocatable指的是, 无论 struct 的实际内存布局如何（可能会根据实际使用的内核版本和内核配置而改变），BPF 程序将被调整以读取相对于结构开始的正确实际偏移量的字段。该功能的实现借助于编译器的`__builtin_preserve_access_index`特性。

- map fd 、全局变量（data、bss、rodata）、extern 的变量重定位，主要依赖于 ELF 的重定位机制，来更新 eBPF 指令的 imm 字段。

- 子函数重定位，是为了将 eBPF 程序调用的子函数同主函数放在一起，便于一起加载到内核。

官方参考指南见[BPF CO-RE refernce guide](https://link.zhihu.com/?target=https%3A//nakryiko.com/posts/bpf-core-reference-guide/)。非官方译文 [BPF CO-RE 参考指南](https://zhuanlan.zhihu.com/p/494293133)。

### 2.2 BTF数据格式

BTF（BPF Type Format）是编码 BPF 程序和 map 结构等相关的调试信息的元数据格式。它可以将元数据数据类型、函数信息和行信息编码成一种紧凑的格式，可以看作是DWARF格式的缩减版。

内核开启`CONFIG_DEBUG_INFO_BTF`配置后，在内核编译的时候记录了内核调试信息，比如内核的结构，字段，偏移量等信息，同时，这些信息内核会输出到`/sys/kernel/btf/vmlinux`中。

BTF详细介绍见内核源码`Documentation/bpf/btf.rst`描述。

以ketones中的shmsnoop为例，可通过bpftool命令查看shmsnoop的BTF数据：

```shell
$ ./src/.output/bpftool/bpftool btf dump file src/.output/shmsnoop.bpf.o 
[24] STRUCT 'event' size=104 vlen=14
	'pid' type_id=21 bits_offset=0
	'tid' type_id=21 bits_offset=32
	'uid' type_id=25 bits_offset=64
	'sys' type_id=3 bits_offset=96
	'ts' type_id=28 bits_offset=128
	'key' type_id=28 bits_offset=192
	'size' type_id=28 bits_offset=256
	'shmflg' type_id=28 bits_offset=320
	'shmid' type_id=28 bits_offset=384
	'cmd' type_id=28 bits_offset=448
	'buf' type_id=28 bits_offset=512
	'shmaddr' type_id=28 bits_offset=576
	'ret' type_id=28 bits_offset=640
	'comm' type_id=30 bits_offset=704
...

# 该信息对应如下结构体：
struct event {
        pid_t pid;
        pid_t tid;
        uid_t uid;
        int sys;
        unsigned long ts;
        unsigned long key;
        unsigned long size;
        unsigned long shmflg;
        unsigned long shmid;
        unsigned long cmd;
        unsigned long buf;
        unsigned long shmaddr;
        unsigned long ret;
        char comm[TASK_COMM_LEN];
};
```

bpftool命令详细介绍见内核源码`tools/bpf/bpftool/Documentation/bpftool-btf.rst`描述。

### 2.3 vmlinux.h 文件

我们可以通过如下命令生产内核本身的BTF信息来消除对本地内核头文件的需求：

```shell
$ bpftool btf dump file /sys/kernel/btf/vmlinux format c > vmlinux.h
```

上述命令将创建一个巨大的 vmlinux.h 文件，其中包含所有内核类型，包括作为 UAPI 的一部分公开的类型、内部类型和通过 kernel-devel 可用的类型，以及一些其他地方不可用的更多内部类型。在 BPF 程序中，我们可以只 #include "vmlinux.h" 并删除其他内核头文件，如 <linux/fs.h>、<linux/sched.h>等。在当前的ketones项目中，vmlinux.h直接同步的上游。

## 3 基本实现流程

### 3.1 命令实现文件层次

ketones中主要是添加各个命令的实现，实现一个tool，一般需要实现如下三个文件（bpflist和tplist除外，它们不需要BPF C code）：

  - \<tool>.c ：包含该工具userspace C code。
  - \<tool>.bpf.c ：包含的是BPF C code，它被编译成BPF ELF文件，该文件将用来生成\<tool>.skel.h，该头文件包含在\<tool>.c中。
  - \<tool>.h：头文件定义，被\<tool>.c和\<tool>.bpf.c使用。

### 3.2 基本开发构建步骤

使用ketones进行BPF CO-RE的开发构建步骤如下：
- 生成libbpf.a库;
- 生成bpftool工具;
- 使用Clang将BPF程序的源代码（\<tool>.bpf.c）编译为.o对象文件;
- 生成BPF skeleton文件，通过`bpftool gen skeleton`命令从编译好的BPF对象文件生成\<tool>.skel.h;
- 在用户空间中包含生成的BPF skeleton头文件;
- 编译用户空间代码，生成用户态程序二进制。

### 3.3 基本函数

\<tool>.c中大致有如下的函数调用：

- \<tool>_bpf__open_opts() ：创建并打开 BPF 应用，之后可以设置 skel->rodata 变量。
- \<too>_bpf__load() ：初始化，加载和校验 BPF 应用部分。
- \<tool>_bpf__attach() ：附加所有可以自动附加的 BPF 程序。有事件和网络运行报文等到达时，会触发运行 bpf 程序。
- \<tool>_bpf__destroy()：分离所有的 BPF 程序并使用其使用的所有资源。

## 4 shmsnoop示例分析

### 4.1 shmsnoop简介

shmsnoop是用来跟踪共享内存相关调用信息的工具。主要是追踪shm*()系统调用。

```shell
$ sudo ./src/bin/shmsnoop 
PID    COMM                SYS              RET ARGs
45121  peony            SHMGET            38054 key: 0x0, size: 1, shmflg: 0x380 (IPC_CREAT|0600)
45121  peony             SHMAT     7fa271cea000 shmid: 0x38054, shmaddr: 0x0, shmflg: 0x0
45121  peony            SHMCTL                0 shmid: 0x38054, cmd: 0, buf: 0x0
45121  peony             SHMDT                0 shmaddr: 0x7fa271cea000
1304   Xorg              SHMAT     7f5f9822d000 shmid: 0x38054, shmaddr: 0x0, shmflg: 0x0
1304   Xorg             SHMCTL                0 shmid: 0x38054, cmd: 2, buf: 0x7ffd4c4ae650
```

### 4.2 shmsnoop eBPF代码

在shmsnoop.bpf.c文件中，可以看到eBPFmap的定义`values`。

```c
struct {
        __uint(type, BPF_MAP_TYPE_HASH);
        __uint(max_entries, MAX_ENTRIES);
        __type(key, pid_t);
        __type(value, struct event);
} values SEC(".maps");
```

values maps用于将事件信息从内核中的eBPF代码传递给用户空间的可执行程序，如下图所示（以shmat为例）：

![image-20230804164724247](/home/tang/.config/Typora/typora-user-images/image-20230804164724247.png)

在文件后面，有挺多相似的函数：

```c
SEC("tracepoint/syscalls/sys_enter_shmat")
int handle_shmat_entry(struct trace_event_raw_sys_enter *ctx)
{
        return probe_entry(ctx, SYS_SHMAT);
}
```

这些函数是eBPF程序的核心，用于探测点的设置和处理，类似于bcc项目中`shmsnoop.py`中的`b.attach_kprobe(event=syscall_fnname, fn_name="syscall__shmat")`语句效果，只是bcc中用的是kprobe类型，而在该文件中使用的是tracepoint类型。

这个函数都有一个指向名为 `trace_event_raw_sys_enter` 结构体指针的参数。可以在你运行的特定内核生成的 `vmlinux.h` 头文件中找到这个结构体的定义。包含了众多上下文信息，比如参数的传递等。

在`probe_entry()`中，使用了BPF辅助函数来检索这个syscall的pid，tid信息：

```c
u64 id = bpf_get_current_pid_tgid();
```

然后通过当前进程pid为key，找到并初始化对应的maps，设置好相应的内容之后，最终将会写入values maps中:

```
event = bpf_map_lookup_or_try_init(&values, &pid, &zero);

event->pid = pid;
event->tid = tid;
event->sys = sys_type;
```

处理了上面这些shm*()共用的成员外，还有一些成员是每个系统调用共用的，比如系统调用的参数，它通过ctx->args[]进行传递：

```c
switch (sys_type) {
    case SYS_SHMGET:
        event->key = (unsigned long)ctx->args[0];
        event->size = (unsigned long)ctx->args[1];
        event->shmflg = (unsigned long)ctx->args[2];
        break;
    case SYS_SHMAT:
        event->shmid = (unsigned long)ctx->args[0];
        event->shmaddr = (unsigned long)ctx->args[1];
        event->shmflg = (unsigned long)ctx->args[2];
        break;
```

可以通过查看内核系统调用处理函数定义来得知参数的顺序；另一种简单办法是直接通过`tplist -v`命令查看内核的tracepoints，命令如下：

```c
$ sudo ./src/bin/tplist -v
...
syscalls:sys_enter_shmat
    int __syscall_nr;
    int shmid;
    char * shmaddr;
    int shmflg;
...
```

与`probe_entry()`相对应的函数`probe_return()`将在系统调用退出时被触发。

在values哈希map中应当有一个与当前进程pid相对应的条目，将event指向对应的条目：

```c
event = bpf_map_lookup_and_delete_elem(&values, &pid);
```

通过`reserve_buf()`的方式保留一段空间用于相关信息填充，后续将通过values map发送到用户空间：

```c
e = reserve_buf(sizeof(struct event));
```

通过BPF辅助函数`bpf_get_current_comm()`获取当前的进程名称，并赋值到实际结构体中：

```c
bpf_get_current_comm(&e->comm, sizeof(e->comm));
```

当所有的信息设置完毕之后，将通过`submit_buf()`写入buffer map中，通过该接口对外发送数据，用户空间的代码将从这个map中读取相关事件信息：

```c
submit_buf(ctx, e, sizeof(struct event));
```

submit_buf（bpf buffer）兼容两种buffer方式，一种是`ringbuf`模式，另一种是`perfbuf`模式。前者实际调用的`bpf_ringbuf_submit`，后者调用的`bpf_perf_event_output`。一般更推荐使用ringbuf模式，性能更强且不会丢失事件，但有些环境上不支持ringbuf，则通过使用submit_buf去兼容这两种模式，详细介绍见[BPF ringbuf vs BPF perfbuf](https://nakryiko.com/posts/bpf-ringbuf/#bpf-ringbuf-vs-bpf-perfbuf)。

从代码中可以看到eBPF程序调用的函数前缀都是`static __always_inline`，这迫使编译器将这些函数的指令放在内联中，因为在旧的内核中，BPF 程序不允许跳转到一个单独的函数。新的内核和 LLVM 版本可以支持非内联的函数调用，但这是一种安全的方式，可以确保 BPF 验证器满意。

### 4.3 Makefile

为了更清楚的了解整个命令的一个构建流程，可以从Makefile中得知。

当构建 eBPF 代码时，首先得到一个包含 eBPF 程序和 map 的二进制定义的对象文件。还需要一个额外的用户空间可执行文件，它将把这些程序和 map 加载到内核中，作为用户的接口。

第一条规则是通过clang编译器将bpf.c文件编译成BPF目标对象文件:

```shell
# Build BPF Code
$(OUTPUT)/%.bpf.o: %/*.bpf.c $(LIBBPF_OBJ) $(wildcard include/*.bpf.h) $(VMLINUX) | $(OUTPUT)
        $(call msg,BPF,$(notdir $@))
        $(Q)$(CLANG) -Wunused-variable -g -O2 -target bpf -D__TARGET_ARCH_$(ARCH) $(INCLUDES) $(CLANG_BPF_SYS_INCLUDES) -c $< -o $@
        $(Q)$(LLVM_STRIP) -g $@ # strip useless DWARF info
```

以shmsnoop为例，即将`shmsnoop.bpf.c`编译成`shmsnoop.bpf.o`文件。这个对象文件包含被加载到内核的eBPF程序和map。

接着使用 `bpftool gen skeleton`，从该 `bpf.o` 对象文件中包含的 map 和程序定义中创建一个骨架头文件：

```shell
# Generate BPF skeletons
$(OUTPUT)/%.skel.h: $(OUTPUT)/%.bpf.o | $(OUTPUT) $(BPFTOOL)
        $(call msg,GEN-SKEL,$(notdir $@))
        $(Q)$(BPFTOOL) gen skeleton $< > $@
```

`shmsnoop.c` 用户空间代码包括这个 `shmsnoop.skel.h` 头文件，以获得它与内核中的 eBPF 程序共享的 map 的定义。这使得用户空间和内核代码能够了解存储在这些 map 中的数据结构体的布局。

下面的规则将用户空间的代码编译成二进制对象：

```shell
# Build user-space code
$(patsubst %,$(OUTPUT)/%.o,$(APPS)): %.o: %.skel.h

$(OUTPUT)/libs/%.o: libs/%.c include/%.h $(LIBBPF_OBJ) | $(OUTPUT)/libs
        $(call msg,CC,$@)
        $(Q)$(CC) $(CFLAGS) $(INCLUDES) -c $(filter %.c,$^) -o $@

$(OUTPUT)/%.o: %/*.c $(wildcard include/*.h) $(LIBBPF_OBJ) | $(OUTPUT)
        $(call msg,CC,$@)
        $(Q)$(CC) $(CFLAGS) $(INCLUDES) -c $(lastword $(filter %.c, $(sort $^))) -o $@
```

通用代码libs目录下的文件放入$(OUTPUT)/libs，特定命令的.c文件放入$(OUTPUT)，对于shmsnoop，则是将`shmsnoop.c` 的编译成为 `shmsnoop.o` 的二进制对象。

最后，有一条规则是使用 cc 将用户空间的应用对象（在我们的例子中是 shmsnoop.o）链接成一组可执行文件：

```shell
# Build application binary
$(BINARIES_DIR)/%: $(OUTPUT)/%.o $(COMMON_LIBS_OBJ) $(LIBBPF_OBJ) | $(OUTPUT) $(BINARIES_DIR)
        $(call msg,BINARY,$(notdir $@))
        $(Q)$(CC) $(CFLAGS) $^ $(ALL_LDFLAGS) -lelf -lz -o $@
```

### 4.4 shmsnoop 用户空间代码

用户空间的代码在 `shmsnoop.c` 文件中。文件的前半部分有 `#include` 指令（其中之一是自动生成的 `shmsnoop.skel.h` 文件），各种定义，以及处理不同命令行选项的代码，我们在此不再赘述。我们还将略过 `print_event()` 等函数，该函数将一个事件的信息显示到屏幕上。从 eBPF 的角度来看，所有有趣的代码都在 `main()` 函数中。

我们会看到像 `shmsnoop_bpf__open_opts()`、`shmsnoop_bpf__load()` 和 `shmsnoop_bpf__attach()` 这样的函数。这些都是在由 `bpftool gen skeleton`自动生成的代码中定义的。这个自动生成的代码处理所有在 eBPF 对象文件中定义的单个 eBPF 程序、map 和附着点。

shmsnoop 启动和运行后，它的工作就是监听 `events` 的 bpf buffer，并将每个事件中包含的信息写到屏幕上。首先，它打开与 bpf buffer 相关的内容，并将 `handle_event()` 设置为新事件到来时要调用的函数：

```c
err = bpf_buffer__open(buf, handle_event, handle_lost_events, NULL);
```

然后它对缓冲区事件进行轮询，直到达到一个时间限制，或者用户中断程序：

```c
while (!exiting) {
                err = bpf_buffer__poll(buf, POLL_TIMEOUT_MS);
```

传递给 `handle_event()` 的data参数指向 eBPF 程序为该事件写进 map 的事件结构体。

```c
static int handle_event(void *ctx, void *data, size_t data_sz)
{
        const struct event *e = data;

        /* name filtering is currently done in user space */
        if (env.name && strstr(e->comm, env.name) == NULL)
                return 0;

        if (env.emit_timestamp)
                printf("%-14.3f ", time_since_start());
        printf("%-6d %-16s %6s %16lx ", e->pid, e->comm, sys_name(e->sys), e->ret);
        print_args(e);

        return 0;
}
```

用户空间的代码可以检索这些信息，将其格式化并写出来给用户看。

正如你所看到的，shmsnoop 注册了 eBPF 程序，每当有应用程序进行 `shm*()` 系统调用时都会被调用。这些运行在内核中的 eBPF 程序收集有关该系统调用的上下文信息。这些信息被写进一个 map，用户空间可以从中读取并显示给用户。