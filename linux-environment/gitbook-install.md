<span id="hidden-autonumber"></span>

<h1 class="article-title">gitbook安装</h1>

# 1 本机环境  
硬件： 阿里云服务器  
架构： x86_64  
操作系统： ubuntu 22.04  

# 2 安装 node
通过命令安装的nodejs版本过高，将无法正常安装gitbook，gitbook需在v10及以下版本进行安装。  
## 2.1 源码方式安装
NOTE: 以下只有第4步用到了sudo权限，其它步骤不需要，不然会出问题。（但有机器只有sudo权限才能在/usr/local下创建目录，那就相关操作也使用sudo权限）
```shell
# 1. 为x86架构
wget wget https://nodejs.org/dist/v10.21.0/node-v10.21.0-linux-x64.tar.gz
# 2. 解压
tar -zxvf node-v10.21.0-linux-x64.tar.gz
# 3. 将相关文件放入/usr/local
mkdir /usr/local/lib/node/
mv node-v10.21.0-linux-x64/ /usr/local/lib/node/nodejs
# 4. 修改环境变量
sudo vim /etc/profile
添加如下内容：
export NODEJS_HOME=/usr/local/lib/node/nodejs
export PATH=$NODEJS_HOME/bin:$PATH
# 5. 临时生效一次，重启后将对当前用户永久生效
source /etc/profile
# 6. 查看node版本是否为v10.21.0
node -v
```
# 3 安装 gitbook
```shell
# 使用普通用户权限
npm install -g gitbook-cli
```
执行gitbook -V （同样只为当前用户使用）
```shell
# 默认将会安装gitbook 3.2.3，将等待一段时间
gitbook -V
```
# 4 可能存在问题
因购买服务器内存较小，执行个gitboot -V 时将导致服务器oom，一直安装失败，详细解决办法见[npm install 内存不足oom时通过创建swap分区](http://tangyouling.com/linux-environment/create-swap.html)