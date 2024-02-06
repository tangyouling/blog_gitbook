<span id="hidden-autonumber"></span>

<h1 class="article-title">网站搭建</h1>


# 1 申请域名和公网ip
可以在阿里云等平台申请域名和公网ip的服务器。  
申请服务器时注意默认开放80端口。  
在域名中添加解析（添加解析后才能通过重定向的域名进行访问）。

# 2 nginx
以ubuntu为例：  

1. 安装nginx
	```shell
	apt install nginx -y
	```
2. 配置nginx
	```shell
	# 下载配置文件（个人需修改）
	wget https://github.com/tangyouling/blog_gitbook.git/config/nginx-config
	# 覆盖默认配置文件
	sudo cp config/nginx-config /etc/nginx/sites-enabled/default
	```
3. 重启nginx服务
	```shell
	sudo systemctl restart nginx
	# 每次开机默认启动
	sudo systemctl enable nginx
	```
4. 访问域名
	```shell
	# 在网页中打开如下域名进行测试（如果没添加域名解析，则可以通过该机器ip进行测试）
	www.tangyouling.com
	```

参考链接：  
http://chenxiaosong.com/linux/chenxiaosong.com.html