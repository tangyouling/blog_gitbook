# <p align="center">kdump工具链测试指导手册</p>

## 桌面系统（deb）测试

### 1. 准备工作

* 安装kexec-tools、makedumpfile和crash

  ```
  # apt install kexec-tools makedumpfile crash
  ```

* 安装要测试的内核包，包含普通内核包和带debuginfo的内核包，debuginfo内核包只用在crash解析阶段

  `4.19.0-19-loongson-3`是具体版本号，需使用具体版本号进行替换，可通过`apt search kernel-image`进行搜索查看有哪些内核包。

  ```
  # apt install linux-image-4.19.0-19-loongson-3 linux-image-4.19.0-19-loongson-3-dbg
  ```

### 2. 测试crashkernel参数

 * 将该参数添加到grub配置中。默认一般使用`crashkernel=auto`

 * 查看crashkernel空间

   存在`Crash kernel`则说明测试成功。

   ```
   # cat /proc/iomem
   90400000-bfffffff : System RAM
     91000000-b0ffffff : Crash kernel
   ```

### 3. 测试kexec快速重启

​	**vmlinuz**: 快速重启的内核镜像位置

​	**initrd-file**: 快速重启时所使用的initrd文件

* 加载测试内核

  当前内核和要加载的内核属于同一个内核，且是要测试的内核镜像。

  ```
  # kexec -l vmlinuz --reuse-cmdline --initrd=initrd_file
  ```

 * 执行快速重启

   执行-e操作之后，内核启动到新加载的内核，且图形界面、网络等正常，则说明测试通过。

   ```
   # kexec -e
   ```

### 4. 测试kdump崩溃转储

* 加载捕获内核

  捕获内核和当前内核属于同一个内核，且是要测试的内核镜像。

  ```
  # kexec -p vmlinuz --reuse-cmdline --initrd=initrd_file
  ```

  针对**`3C5000`**机器时，需要增加`nr_cpus=1`参数，类似如下：

  ```
  # kexec -p vmlinuz --reuse-cmdline --append="nr_cpus=1" --initrd=initrd_file
  ```

 * 触发panic

   触发panic后，等待些许时间后，将进入捕获内核，并生`/proc/vmcore`，如果能生成vmcore，则说明测试通过。

   ```
   # echo c > /proc/sysrq-trigger
   ```

 * 查看vmcore

   vmcore大小和当前的机器内存大小有关。

   ```
   # ls -lh /proc/vmcore
   ```

### 5. 测试makedumpfile

 * 生成dumpfile文件

   能成功生成dumpfile文件则说明测试通过，之后从捕获内核中执行reboot重启，进入普通内核后再进行crash分析。

   ```
   # makedumpfile -c -d 31 /proc/vmcore dumpfile
   ```

### 6. 测试crash

 * 测试转储文件

   **vmlinux-debug**:和生产内核同一源码，但开启`CONFIG_DEBUG_INFO`生成的vmlinux

   ```
   $ sudo crash dumpfile vmlinux-debug
   ```

   能成功进入`crash>`命令行，且`bt`命令显示正常，类似如下，则说明测试通过。

   ```
   eg:
   $ sudo crash /usr/lib/debug/boot/vmlinux-4.19.0-19-loongson-3 dumpfile
         KERNEL: /usr/lib/debug/boot/vmlinux-4.19.0-19-loongson-3            
       DUMPFILE: /home/loongson/dumpfile  [PARTIAL DUMP]
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

## 服务器系统（rpm）测试

服务器系统上基于kdump服务的方式测试。

服务器系统上一般默认安装和开启了kdump服务，开启情况下无需手动去添加crashkernel参数和下载kexec-tools，该kexec-toolso由kexec-tools本身，makedumpfile和kdump服务组成。

### 1. 测试kexec快速重启

​	**vmlinuz**: 快速重启的内核镜像位置

​	**initrd-file**: 快速重启时所使用的initrd文件

* 加载测试内核

  当前内核和要加载的内核属于同一个内核，且是要测试的内核镜像。

  ```
  # kexec -l vmlinuz --reuse-cmdline --initrd=initrd_file
  ```

 * 执行快速重启

   执行-e操作之后，内核启动到新加载的内核，且图形界面、网络等正常，则说明测试通过。

   ```
   # kexec -e
   ```

### 2. 测试kdump服务

kdump服务测试包含了crashkernel，kdump，makedumpfile的测试。

 * 查看kdump服务是否加载成功

   如果显示绿色，即显示为`active`，则说明kdump加载测试成功。

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

 * 测试内核panic之后，kdump后续操作是否成功

   * 触发panic

     ```
     # echo c > /proc/sysrq-trigger
     ```

     内核panic后，将会通过kdump服务自动进入捕获内核，并收集现场生成`/proc/vmcore`，然后自动通过makedumpfile工具，将vmcore文件自动转储压缩，并存放到`/var/crash/`目录下。这些操作完成之后，将自动reboot重启到普通内核。此一系列操作需等待几十秒至几分钟不等。然后查看压缩后的转储文件vmcore，类似如下，

     ```
     # tree /var/crash/127.0.0.1-2023-03-22-17\:09\:27/
     /var/crash/127.0.0.1-2023-03-22-17:09:27/
     ├── kexec-dmesg.log
     ├── vmcore
     └── vmcore-dmesg.txt
     ```

     在该目录下如果能生成vmcore文件，则说明kdump服务测试成功。

### 3. 测试crash

 * 测试转储文件

   **vmlinux-debug**:和生产内核同一源码，但开启`CONFIG_DEBUG_INFO`生成的vmlinux

   ```
   $ sudo crash dumpfile vmlinux-debug
   ```

   能成功进入`crash>`命令行，且`bt`命令显示正常，类似如下，则说明测试通过。

   ```
   eg:
   $ sudo crash /usr/lib/debug/lib/modules/4.19.190+/vmlinux /var/crash/127.0.0.1-2023-03-22-16\:38\:03/vmcore
         KERNEL: /usr/lib/debug/lib/modules/4.19.190+/vmlinux            
       DUMPFILE: /var/crash/127.0.0.1-2023-03-22-16\:38\:03/vmcore [PARTIAL DUMP]
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