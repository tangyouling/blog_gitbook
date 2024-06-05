#/usr/bin/env bash

OUTPUT_DIRECTORY=~/work/woboq-out/linux		# 生成文件的目录
if [ -d ${OUTPUT_DIRECTORY} ]; then
    rm -rf ${OUTPUT_DIRECTORY}/*
else
    mkdir -p ${OUTPUT_DIRECTORY}
fi

DATA_DIRECTORY=$OUTPUT_DIRECTORY/../data	# 用来存放js，css数据目录
BUILD_DIRECTORY=$PWD				# 当前目录
SOURCE_DIRECTORY=$PWD				# 源代码目录
VERSION=`git describe --always --tags`		# 版本信息

codebrowser_generator -color -b $BUILD_DIRECTORY -a -o $OUTPUT_DIRECTORY \
        -p codebrowser:$SOURCE_DIRECTORY:$VERSION --code-model=kernel
codebrowser_indexgenerator $OUTPUT_DIRECTORY


mkdir $DATA_DIRECTORY
# 拷贝data目录相关数据（包含js,css等格式内容）
cp -rf /usr/local/share/woboq/data/* $DATA_DIRECTORY/

# python -m http.server port
