<span id="hidden-autonumber"></span>

<h1 class="article-title">创建swap分区</h1>

# 1 问题来源
在服务器安装gitbook时，执行gitbook -V时，一直停留在Install Gitbook 3.2.3，服务器被oom,原因是云服务器内存不足，node相关进程被killed。
# 2 解决办法  
1 创建swap分区
```shell
# 创建4G swapfile文件
sudo mkdir /opt/swap/
sudo dd if=/dev/zero of=/opt/swap/swapfile bs=1M count=4096

# 将swapfile设置为swap交换区
sudo mkswap /opt/swap/swapfile

# 启用swap交换区
sudo swapon /opt/swap/swapfile

# 设置为开机自动挂载交换区
sudo echo "/opt/swap/swapfile swap swap defaults 0 0" >> /etc/fstab

# 设置交换区使用参数
# 表示内存使用率超过50%是开始使用交换区资源
sudo vim /etc/sysctl.conf # 将vm.swappiness = 0值改为50

# 加载参数
sudo sysctl -p
```  

2 如果想重新创建swap分区大小
执行`sudo swapoff /opt/swap/swapfile`操作后，再重新执行创建操作即可。
