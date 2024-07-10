# <p align="center">LoongArch qemu ArchLinux搭建</p>

## 安装相关包

通用包：

```sh
sudo yum install autoconf automake libmpc-devel mpfr-devel gmp-devel 
gawk bison flex \
                  texinfo patchutils gcc gcc-c++ zlib-devel expat-devel git

```

## 下载qemu源码

```sh
wget https://download.qemu.org/qemu-7.2.0.tar.xz
```

安装依赖：

```sh
sudo yum install libslirp-devel
```

## 编译qemu

```sh
$ tar xf qemu-7.2.0.tar.gz
$ cd qemu-7.2.0
$ mkdir build
$ cd build/
$ ../configure  --enable-slirp 
--target-list=loongarch64-linux-user,loongarch64-softmmu 
--prefix=/home/tangyouling/loongarch-qemu/qemu-work
$ make -j8
$ make install
$ export PATH=$PATH:/home/tangyouling/loongarch-qemu/qemu-work/bin
```

## 下载edk2固件

```sh
wget https://mirrors.wsyu.edu.cn/loongarch/archlinux/images/QEMU_EFI_7.2.fd
```

## qcow2下载

```sh
wget https://mirrors.wsyu.edu.cn/loongarch/archlinux/images/archlinux-xfce4-2022.12.03-loong64.qcow2.zst

解压：
zstd -d archlinux-xfce4-2022.12.03-loong64.qcow2.zst
```

## qcow2密码修改

Link: https://nanibot.net/posts/modify-root-password-qcow2/

```sh
此qcow2知道密码，所以跳过密码修改
```

```
用户：loongarch
密码：loongarch
```

## 启动qcow2中自带内核

启动脚本如下：

```sh
[tangyouling@bogon loongarch-qemu]$ cat run.sh
#!/usr/bin/env bash

# The script is created for starting a LoongArch qemu virtual machine with specific parameters.

## Configuration

qemu-system-loongarch64 \
    -m 4G \
    -cpu la464-loongarch-cpu \
    -machine virt \
    -smp 4 \
    -bios ./QEMU_EFI_7.2.fd \
    -serial stdio \
    -net nic -net user \
    -device virtio-vga \
    -device nec-usb-xhci,id=xhci,addr=0x1b \
    -device usb-tablet,id=tablet,bus=xhci.0,port=1 \
    -device usb-kbd,id=keyboard,bus=xhci.0,port=2 \
    -hda archlinux-xfce4-2022.12.03-loong64.qcow2

eval $cmd

```

## 更新源

启动到qemu机器里时，发现安装软件时失败，可以修改源

```sh
vim /etc/pacman.d/mirrorlist
```

我更改为了如下：

```
[root@archlinux loongarch]# cat /etc/pacman.d/mirrorlist 
##
## Arch Linux repository mirrorlist
## Generated on 2022-09-24
##

## China
Server = https://mirrors.wsyu.edu.cn/loongarch/archlinux/$repo/os/$arch
```

修改源后需更新仓库

```sh
sudo pacman -Sy
```

安装dracut，后续做initramfs需要

```sh
sudo pacman -S dracut
```

## 启动自编译内核

- 编译内核
- 拷贝模块

```sh
sudo make ARCH=loongarch modules_install
sudo tar -zcvf 6.3.0.tar.gz /lib/modules/6.3.0/
```

然后将该模块拷贝到已启动的qemu的环境中。

- 制作initramfs

在qemu环境中制作。

```sh
dracut /boot/initramfs-6.3.0.img 6.3.0
```

可以将制作好的initramfs拷贝出来。

- 启动新编好的内核

可以通过-kernel指定的方式启动，这样就不需要拷贝内核。

-append命令来自于启默认内核后的命令，然后自己可以进行相应修改

```sh
[tangyouling@bogon loongarch-qemu]$ cat run-loongarch.sh
#!/usr/bin/env bash

# The script is created for starting a LoongArch qemu virtual machine with specific parameters.

## Configuration
/home/tangyouling/loongarch-qemu/qemu-work/bin/qemu-system-loongarch64 \
    -m 4G \
    -cpu la464-loongarch-cpu \
    -machine virt \
    -nographic \
    -smp 4 \
    -bios ./QEMU_EFI_7.2.fd \
    -kernel vmlinux.efi \
    -initrd initramfs-linux-6.3.0.img \
    -append 'root=UUID=5fa5b8ca-3393-441c-a70d-035ed8f597ed rw rootfstype=ext4 loglevel=8 console=ttyS0,115200 earlycon' \
    -net nic -net user \
    -device virtio-vga \
    -device nec-usb-xhci,id=xhci,addr=0x1b \
    -device usb-tablet,id=tablet,bus=xhci.0,port=1 \
    -device usb-kbd,id=keyboard,bus=xhci.0,port=2 \
    -hda archlinux-xfce4-2022.12.03-loong64.qcow2


eval $cmd

```

```sh
sudo bash run-loongarch.sh
```

## ssh方式连接

Link: https://blog.csdn.net/qq_35315699/article/details/86775899

通过ip方式进行ssh连接该虚拟机时无法连接，因为该虚拟机ip无法ping通。

可以通过端口号方式连接，在启动命令中添加端口号，启动脚本修改为如下

```sh
/home/tangyouling/loongarch-qemu/qemu-work/bin/qemu-system-loongarch64 \
    -m 4G \
    -cpu la464-loongarch-cpu \
    -machine virt \
    -nographic \
    -smp 4 \
    -bios ./QEMU_EFI_7.2.fd \
    -kernel vmlinux.efi \
    -initrd initramfs-linux-6.3.0-rc7.img \
    -append 'root=UUID=5fa5b8ca-3393-441c-a70d-035ed8f597ed rw rootfstype=ext4 loglevel=8 console=ttyS0,115200 earlycon' \
    -net nic -net user,hostfwd=tcp::10021-:22 \
    -device virtio-vga \
    -device nec-usb-xhci,id=xhci,addr=0x1b \
    -device usb-tablet,id=tablet,bus=xhci.0,port=1 \
    -device usb-kbd,id=keyboard,bus=xhci.0,port=2 \
    -hda archlinux-xfce4-2022.12.03-loong64.qcow2

```

可看到端口号为10021，注意起多个虚拟机时，端口号不能重复，需修改。

```sh
ssh loongarch@127.0.0.1 -p 10021
```

## 参考链接

http://www.dtmao.cc/ios/68945.html