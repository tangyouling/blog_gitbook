# 替换为自己的存放目录（该目录需和nginx-config中配置一致）
PATH_HTML=/var/tangyouling/www/html

# 配置nginx的配置文件
sudo cp config/nginx-config /etc/nginx/sites-enabled/default

# 移除旧的html文件
sudo rm $PATH_HTML -rf
# 创建存放网页目录
sudo mkdir -p $PATH_HTML

# 将构建好的网页和相关文件放到nignx的配置目录中
sudo cp _book/* $PATH_HTML -rf

# 重启nginx服务
sudo systemctl restart nginx.service
