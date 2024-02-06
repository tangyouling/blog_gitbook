# !NOTE 在该仓库的根路径下执行

# 安装gitbook相关插件，根据该目录下的book.js文件
gitbook install
# 构建
gitbook build

# 执行ngnix配置脚本
bash script/config_nginx.sh
