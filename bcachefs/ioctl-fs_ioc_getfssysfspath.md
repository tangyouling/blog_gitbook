<span id="hidden-autonumber"></span>

<h1 class="article-title">ioctl 之 FS_IOC_GETFSSYSFSPATH</h1>

# 1 测试用例
```c
$ cat ioctl_getsysfspath.c 

 #include <stdio.h>
 #include <stdlib.h>
 #include <fcntl.h>
 #include <sys/ioctl.h>
 #include <linux/fs.h>
 #include <unistd.h>

 int main(int argc, char *argv[]) {
     int fd;
     struct fs_sysfs_path sysfs_path = {};

     if (argc != 2) {
         fprintf(stderr, "Usage: %s <path_to_file_or_directory>\n", argv[0]);
         exit(EXIT_FAILURE);
     }

     fd = open(argv[1], O_RDONLY);
     if (fd == -1) {
         perror("open");
         exit(EXIT_FAILURE);
     }

     if (ioctl(fd, FS_IOC_GETFSSYSFSPATH, &sysfs_path) == -1) {
         perror("ioctl FS_IOC_GETFSSYSFSPATH");
         close(fd);
         exit(EXIT_FAILURE);
     }

     printf("FS_IOC_GETFSSYSFSPATH: %s\n", sysfs_path.name);
     close(fd);
     return 0;
 }
```

# 2 增加bcachefs对其支持

[[PATCH 1/2] bcachefs: Add support for FS_IOC_GETFSUUID](https://lore.kernel.org/all/20240709011134.79954-1-youling.tang@linux.dev/)

[[PATCH 2/2] bcachefs: Add support for FS_IOC_GETFSSYSFSPATH](https://lore.kernel.org/all/20240709011134.79954-2-youling.tang@linux.dev/)

缺失patch1的话，sb->s_uuid_len值将为0,最终会导致返回`-ENOTTY`从而获取失败。
