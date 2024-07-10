# <p align="center">kdump 服务</p>

## 简介

kdump服务提供了内核的崩溃转储机制，可以在i内核崩溃时保存系统内存信息。

## 安装

1. 安装kexec-tools

   该包由kexec-tools本身，makedumpfile和kdump服务组成。

   ```
   # yum install kexec-tools
   ```

2. 设置crashkernel参数

   将该参数添加到grub配置中。默认一般使用`crashkernel=auto`或者`crashkernel=512M`(在LoongArch架构)

3. 查看crashkernel空间

   如果crashkernel空间预留成功，则如下：

   ```
   # cat /proc/iomem
   90400000-bfffffff : System RAM
     91000000-b0ffffff : Crash kernel
   ```

## kdump服务管理

 1. 启用kdump

    ```
    # systemctl enable kdump
    ```

 2. 启动kdump

    ```
    # systemctl start kdump
    ```

 3. 停止kdump

    ```
    # systemctl stop kdump
    ```

 4. 重新启动kdump

    ```
    # systemctl restart kdump
    ```

 5. 禁用kdump

    ```
    # systemctl disable kdump
    ```

 6. 查看kdump状态

    ```
    # systemctl status kdump
    ● kdump.service - Crash recovery kernel arming
       Loaded: loaded (/usr/lib/systemd/system/kdump.service; enabled; vendor prese>
       Active: active (exited) since Wed 2023-03-22 17:12:08 CST; 21h ago
      Process: 967 ExecStart=/usr/bin/kdumpctl start (code=exited, status=0/SUCCESS)
     Main PID: 967 (code=exited, status=0/SUCCESS)
        Tasks: 0 (limit: 98076)
       Memory: 0B
       CGroup: /system.slice/kdump.service
    
    3月 22 17:12:07 localhost.localdomain systemd[1]: Starting Crash recovery kerne>
    3月 22 17:12:08 bogon kdumpctl[967]: kdump: kexec: loaded kdump kernel
    3月 22 17:12:08 bogon kdumpctl[967]: kdump: Starting kdump: [OK]
    3月 22 17:12:08 bogon systemd[1]: Started Crash recovery kernel arming.
    ```

## 触发panic

1. 可通过人工方式手动使内核崩溃进行测试，执行如下命令后，内核将会panic

   ```
   # echo c > /proc/sysrq-trigger
   ```

## vmcore收集

 1. 内核panic后，将会通过kdump服务自动进入捕获内核，并收集现场生成`/proc/vmcore`，然后自动通过makedumpfile工具，将vmcore文件自动转储压缩，并存放到`/var/crash/`目录下，类似如下，

    ```
    # tree /var/crash/127.0.0.1-2023-03-22-17\:09\:27/
    /var/crash/127.0.0.1-2023-03-22-17:09:27/
    ├── kexec-dmesg.log
    ├── vmcore
    └── vmcore-dmesg.txt
    ```

## crash工具

crash工具用来解析崩溃转储文件。

 1. 安装crash

    ```
    # yum install crash
    ```

 2. 安装带调式信息的内核

    ```
    # yum install kernel-debuginfo
    ```

 3. crash 分析

    ```
    # crash /usr/lib/debug/lib/modules/4.19.190+/vmlinux /var/crash/127.0.0.1-2023-03-22-16\:38\:03/vmcore
    ...
          KERNEL: /usr/lib/debug/lib/modules/4.19.190+/vmlinux           
        DUMPFILE: /var/crash/127.0.0.1-2023-03-22-16:38:03/vmcore  [PARTIAL DUMP]
            CPUS: 4
            DATE: Wed Mar 22 16:37:53 CST 2023
          UPTIME: 00:13:22
    LOAD AVERAGE: 1.16, 3.06, 1.90
           TASKS: 274
        NODENAME: bogon
         RELEASE: 4.19.190+
         VERSION: #1 SMP Wed Mar 22 14:32:54 CST 2023
         MACHINE: loongarch64  (2500 Mhz)
          MEMORY: 16 GB
           PANIC: "CPU 3 Unable to handle kernel paging request at virtual address 0000000000000000, era == 9000000000a61044, ra == 9000000000a619cc"
             PID: 1613
         COMMAND: "bash"
            TASK: 900000043b294300  [THREAD_INFO: 900000043b230000]
             CPU: 3
           STATE: TASK_RUNNING (PANIC)
    
    crash> bt
    PID: 1613   TASK: 900000043b294300  CPU: 3   COMMAND: "bash"
     #0 [900000043b233d50] sysrq_handle_crash at 9000000000a61044
     #1 [900000043b233d50] __handle_sysrq at 9000000000a619cc
     #2 [900000043b233d90] write_sysrq_trigger at 9000000000a61f28
     #3 [900000043b233db0] proc_reg_write at 90000000004d02b0
     #4 [900000043b233dd0] __vfs_write at 900000000044a328
     #5 [900000043b233e50] vfs_write at 900000000044a62c
     #6 [900000043b233e80] ksys_write at 900000000044a8fc
    ```