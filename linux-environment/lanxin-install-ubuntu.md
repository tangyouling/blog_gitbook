<span id="hidden-autonumber"></span>

<h1 class="article-title">ubuntu 22.04 安装蓝信</h1>

# 1 本机环境  
架构： x86_64  
操作系统： ubuntu 22.04  

# 2 下载wine和lanxin包
```
# 下载wine
wget http://archive.ubuntukylin.com/software/pool/partner/ukylin-wine_70.6.3.25_amd64.deb

# 下载蓝信
wget http://archive.ubuntukylin.com/software/pool/partner/ukylin-lanxin_2.0_amd64.deb 
```

# 3 安装wine和lanxin
```
# 安装wine
sudo apt-get install -f -y ./ukylin-wine_70.6.3.25_amd64.deb

# 安装蓝信
sudo apt-get install -f -y ./ukylin-lanxin_2.0_amd64.deb
```

参考链接：https://www.ubuntukylin.com/applications/118-en.html
