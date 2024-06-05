<span id="hidden-autonumber"></span>

<h1 class="article-title">通过woboq构建代码在线浏览</h1>

# 1 本机环境  

操作系统： ubuntu 22.04  

# 2 安装
## 2.1 源码方式安装woboq
```shell
# 克隆woboq项目
git clone https://github.com/woboq/woboq_codebrowser.git

# 编译woboq
cd woboq_codebrowser
mkdir build && cd build
cmake  -DCMAKE_BUILD_TYPE=Release ..
make

# 安装woboq
sudo make install
```

## 2.2 安装bear

bear主要用来生成`compile_commands.json`文件。

```sh
sudo apt install bear
```

# 3 构建

当前文件目录层次（以下命令执行位置直接以该为例）：

```sh
$ tree
work/
├── woboq_codebrowser	# woboq源码存放目录
├── linux				# linux源码存放目录
└── woboq-out			# 通过执行woboq相关目录生成的文件存放位置
    ├── data			# 存放相关的css,js格式文件
    └── linux			# 存放生成的文件（包含html等）

```

## 3.1 生成compile_commands.json文件

以linux源码为例。

```sh
# linux源码clone
git clone https://mirrors.tuna.tsinghua.edu.cn/git/linux.git

# 在编译命令前追加bera -- 即可
cd linux
make defconfig && make menuconfig
bear -- make
```

内核编译完成之后将在该linux源码目录下生成`compile_commands.json`文件。

## 3.2 构建html等文件

在linux源码目录下（work/linux）执行如下脚本[woboq_build_codebrowser.sh](https://github.com/tangyouling/blog_gitbook.git/script/woboq_build_codebrowser.sh)（根据自己需求修改）：

```sh
wget https://github.com/tangyouling/blog_gitbook.git/script/woboq_build_codebrowser.sh
```

```sh
#/usr/bin/env bash

OUTPUT_DIRECTORY=~/work/woboq-out/linux         # 生成文件的目录
if [ -d ${OUTPUT_DIRECTORY} ]; then
    rm -rf ${OUTPUT_DIRECTORY}/*
else
    mkdir -p ${OUTPUT_DIRECTORY}
fi

DATA_DIRECTORY=$OUTPUT_DIRECTORY/../data        # 用来存放js，css数据目录
BUILD_DIRECTORY=$PWD                            # 当前目录
SOURCE_DIRECTORY=$PWD                           # 源代码目录
VERSION=`git describe --always --tags`          # 版本信息

codebrowser_generator -color -b $BUILD_DIRECTORY -a -o $OUTPUT_DIRECTORY \
        -p codebrowser:$SOURCE_DIRECTORY:$VERSION --code-model=kernel
codebrowser_indexgenerator $OUTPUT_DIRECTORY

mkdir $DATA_DIRECTORY
# 拷贝data目录相关数据（包含js,css等格式内容）
cp -rf /usr/local/share/woboq/data/* $DATA_DIRECTORY/
```

## 3.3 构建网页

```sh
# 在work/woboq-out执行该目录
python -m http.server port

eg:
python -m http.server 8088
```

或者通过nginx方式。

# 4 参考

参考：https://blog.wingszeng.top/deploy-woboq-code-browser/
