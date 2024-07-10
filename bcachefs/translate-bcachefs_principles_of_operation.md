<span id="hidden-autonumber"></span>

<h1 class="article-title">bcachefs 工作原理 -- 译《bcachefs: Principles of Operation》</h1>

原文：[bcachefs: Principles of Operation](https://bcachefs-docs.readthedocs.io/en/latest/)

# 1 概述

## 1.1 介绍
bcachefs是一个从bcache(一个块层缓存)的**COW(写时复制)文件系统**。

内部架构和大多数现有文件系统不一样，**inode位于中心**位置，许多数据结构悬挂在inode上。bcachefs更像是关系文件数据库之上的文件系统，具有不同类型的表 -- extents, inodes, dirents, xattrs等. 

bachefs几乎支持与其他现代COW文件系统(如ZFS和btrfs)相同的所有特性，但通常具有更简洁、更简单、性能更高的设计。

## 1.2 性能
该架构的核心是一个**高性能和低延迟的b+树**，它也不是传统的b+树，而是更多的混合，从压缩数据结构中汲取概念2:b树节点非常大，采用**日志结构**，并根据需要在内存中进行压缩。这意味着与其他文件系统相比，我们的b+树非常浅。

对于最终用户来说，这意味着由于我们需要很少的查找或磁盘读取，所以文件系统延迟非常好——特别是缓存冷文件系统延迟，它在大多数基准测试中没有显示出来，但对现实世界的性能有巨大影响，以及系统在正常交互使用中“感觉”有多快。延迟一直是整个代码库的主要关注点——值得注意的是，我们断言在做IO时从不持有b+树锁，并且b树事务层使得在需要时积极地删除和重新获取锁变得很容易——bachefs的一个主要目标是成为第一个通用的软实时文件系统。

此外，与其他 COW btree 不同，btree 更新是日志式的。 这大大提高了我们在随机更新工作负载上的写入效率， 因为这意味着只有当我们有一大块更新，或者在内存回收或日志回收需要时进行b树更新。   

## 1.3 基于存储桶的分配
如前所述，bachefs源自bcache，在bcache中，其核心设计需求有效地使缓存数据失效和重用磁盘空间的能力。为了实现这一点，分配器将磁盘划分为**bucket**，通常为512k到2M，但也可能更大或更小。桶和数据指针都有生成编号:我们可以重用包含缓存数据的桶，而无需通过增加生成编号来查找和删除所有数据指针。

通过增加生成数来保留所有数据指针。为了与写时复制的主题保持一致，即尽可能避免就地更新，我们从不重写或覆盖桶内的数据——当我们分配一个桶时，我们按顺序写入它，然后在桶失效和生成数增加之前我们不会再次写入它。

这意味着我们需要一个**复制垃圾收集器**（copygc)来处理内部碎片，当随机写模式给我们留下了许多部分空的桶(因为它们包含的数据被覆盖了)——复制GC（garbage collector）通过将它们包含的数据写入新桶来疏散大部分空的桶。这也意味着在格式化时，我们需要在设备上为拷贝GC保留空间——通常是8%或12%。

除了能够支持缓存数据之外，以这种方式构建分配器还有一些优点:   

- 通过维护多个写入不同桶的写指针，我们能够轻松而自然地将不相关的IO从不同的进程中分离出来，这对碎片化有很大帮助。
- 分配器的快速路径本质上是一个简单的bump分配器——磁盘空间分配非常快。
- 碎片通常不是问题，除非必须启动copygc，而在典型的使用模式下通常不会。分配器和copygc所做的事情本质上与ssd中的闪存转换层相同，但是在文件系统中，我们可以更好地了解写来自何处，如何隔离它们，以及哪些数据实际上是实时的——在类似的使用模式下，性能通常比ssd更可预测。
- 相同的算法将在将来用于直接管理SMR硬盘驱动器，避免硬盘驱动器中的转换层——在文件系统中完成这项工作将提供更好的性能和更可预测的延迟。

# 2 特性
## 2.1 IO路径选项
控制IO路径的大多数选项可以在文件系统级别或在单个inode(文件和目录)上设置。当通过`bcachefs attr`命令在目录上设置时，它们将自动递归地应用。   
### 2.1.1 校验和
Bcachefs同时支持元数据和数据校验和——默认为crc32c，但也可以使用更强的校验和。启用数据校验和会带来一些性能开销——除了校验和计算之外，为了校验和的稳定性，写操作必须被bounced（退回）(Linux通常不能保证正在写入的缓冲区不会在运行中被修改)，但是读操作通常不必被退回。

bachefs中的校验和粒度处于单个extents的级别，这导致更小的元数据，但意味着我们必须读取整个区段才能验证校验和。默认情况下，校验和压缩区的上限为64k。对于大多数应用程序和使用场景来说，这是一种理想的折衷，但是小的随机O_DIRECT读取会带来很大的开销。将来，校验和粒度将是per-inode的选项。

### 2.1.2 加密
bcachefs支持认证(AEAD风格)加密- ChaCha20/Poly1305。当启用加密时，poly1305 MAC将替换正常的数据和元数据校验和。这种加密方式优于典型的块层或文件系统级加密(通常是AES-XTS)，后者只在块上操作，没有存储随机数或mac的方法。相比之下，我们将nonce和加密MAC与数据指针一起存储——这意味着我们拥有一条到超级块(或日志，在不干净关闭的情况下)的信任链，并且可以明确地判断元数据是否已被修改、删除或替换为早期版本——重放攻击（replay attack）是不可能的。

只能为整个文件系统指定加密，而不能为每个文件或目录指定加密——这是因为元数据块不属于特定的文件。除了超级块之外，所有元数据都是加密的。

将来，我们可能会为具有AES硬件加速的平台添加AES- gcm，但与此同时，ChaCha20的软件实现在大多数平台上也相当快。

`Scrypt`用于密钥派生功能 -- 用于将用户提供的密码短语转换为加密密钥。   
要对文件系统进行加密格式化，请使用:

```sh
bcachefs format --encrypted /dev/sda1
```
系统将提示您输入密码短语。然后，使用这个命令来使用加密的文件系统   
```sh
bcachefs unlock /dev/sda1
```
您将被提示输入密码短语，加密密钥将被添加到您的内核密钥环中;mount、fsck和其他命令将像往常一样工作。

可以使用`bcachefs set-passphrase`命令更改现有加密文件系统上的密码短语。要永久解锁加密的文件系统，可以使用`bcachefs remove-passphrase`命令 -- 这在转储文件系统元数据供开发人员调试时非常有用。

有一个宽macs选项，它控制存储在磁盘上的加密MACs的大小。默认情况下，只存储80位，这对于大多数应用程序来说应该已经足够安全了。启用了wide macs选项后，我们存储了完整的128位MAC，代价是使区段(extents)增大8字节。

### 2.1.3 压缩
Bcachefs支持gzip、lz4和zstd压缩。与数据校验和一样，我们压缩整个extents，而不是单个磁盘块——这给了我们比其他文件系统更好的压缩率，但代价是降低了小随机读性能。

如果设置了`background_compression`选项，rebalance线程也可以在后台用不同的算法压缩或重新压缩数据。

## 2.2 Multiple devices
Bcachefs是一个`multi-device`文件系统。设备不需要是相同的大小:默认情况下，分配器将在所有可用设备上分条，但偏向于具有更多空闲空间的设备，以便文件系统中的所有设备以相同的速率填充。设备不需要具有相同的性能特征:我们跟踪设备的IO延迟，并直接读取到当前最快的设备。
### 2.2.1 复制（Replication）
bcachefs通过`data_replicas`和`metadata_replicas`选项支持标准RAID1/10风格的冗余。布局不像RAID10那样固定:给定的范围可以跨任何一组设备进行复制;`bcachefs fs usage`命令显示了如何在文件系统中复制数据。
### 2.2.2 纠删码（Erasure coding）
bcachefs 还支持`Reed-Solomon`纠删码 - 相同的算法大多数RAID5/6实现都使用）当启用时`ec `选项中，所需的冗余取自`data_replicas`选项 - 不支持元数据的纠删码。 

EC的工作方式与传统的RAID实现和其他具有类似功能的文件系统有很大的不同。在传统的RAID中，“write hole”是一个重要的问题——在条带内做一个小的写操作也需要更新P和Q(恢复)块，而且由于这些写操作不能自动完成，因此存在一个P和Q块不一致的窗口——这意味着如果系统崩溃并在驱动器丢失的情况下恢复，那么条带内不相关数据的重构读取将被破坏。

ZFS通过对单个写操作进行碎片化来避免这种情况，这样每次写操作都变成一个新的条带——这是可行的，但是碎片化会对性能产生负面影响:元数据变得更大，读写请求都过于碎片化。Btrfs的EC实现更传统，但仍然存在写洞问题。

Bcachefs的擦除编码利用了我们写时复制的特性——因为就地更新条带是个问题，所以我们根本不这样做。由于过小的条带对于碎片来说是一个问题，所以我们不擦除单个extents的代码，而是擦除整个bucket——利用基于bucket的分配和复制garbage collection的优势。

当启用EC时，最初会复制写操作，但其中一个副本是从一个桶中分配的，该桶排队作为新条带的一部分。当我们填满新的条带时，我们写出P和Q桶，然后删除该条带内所有数据的额外副本——效果类似于完整的数据日志记录，这意味着在擦除编码完成后，磁盘上的数据布局是理想的。

由于磁盘有写缓存，只有当我们发出缓存刷新命令时才会刷新——我们只在日志提交时才会刷新——如果我们可以调整分配器，以便立即重用(然后再次覆盖)用于额外副本的桶，那么这个完整的数据日志记录的开销应该可以忽略不计——然而，这种优化尚未实现。

### 2.2.3 设备标签和目标
默认情况下，写操作是跨文件系统中的所有设备进行的，但是它们也可以定向到具有各种目标选项的特定设备或设备集。分配器只倾向于从匹配指定目标的设备进行分配;如果这些设备已满，它将返回到从文件系统中的任何设备进行分配。

目标选项可以直接引用设备，例如foreground_target=/dev/sda1，或者它们可以引用设备标签。设备标签是由句号分隔的路径，例如ssd.ssd1(并且标签不需要是唯一的)。这为我们提供了在目标选项中引用多个设备的方法:如果我们在目标选项中指定ssd，那么它将引用所有带有ssd标签或以ssd开头的标签的设备。(如ssd.ssd1 ssd.ssd2)。

存在四个目标选项。这些选项都可以在文件系统级别设置(在格式化时，在挂载时，或在运行时通过sysfs)，或者在特定的文件或目录上设置:   

- foreground_target: 正常的前台（foreground）数据写入，如果没有设置metadata_target，则写入元数据
- metadata_target: btree 写入
- background_target: 如果设置，用户数据(不是元数据)将在后台移动到此目标
- promote_target: 如果设置，则在读取时将缓存副本添加到此目标(如果不存在)
### 2.2.4 缓存
当一个区段在不同的设备上有多个副本时，其中一些副本可能被标记为已缓存。只包含缓存数据的桶根据分配器的需要按LRU顺序被丢弃。

当根据`background_target`选项将数据从一个设备移动到另一个设备时，原始副本保留在原位，但标记为缓存。使用`promote_target`选项，原始副本保持不变，`promote_target`设备上的新副本被标记为缓存。

如果要进行writebace缓存，需要将`foreground_target`和`promote_target`设置为缓存设备，将`background_target`设置为备份设备。要进行writearound缓存，请将`foreground_target`设置为备份设备，并将`promote_target`设置为缓存设备。   

### 2.2.5 耐久性（Durability）
有些设备可能被认为比其他设备更可靠。例如，我们可能有一个由硬件RAID阵列和几个NVME闪存设备组成的文件系统，用作缓存。我们可以设置replicas=2，这样丢失任何NVME闪存设备都不会导致我们丢失数据，然后我们还可以为硬件RAID设备设置耐久性=2，告诉bcachefs我们不需要该设备上的数据额外的副本-该设备上的数据将算作两个副本，而不仅仅是一个。

耐久性选项也可以用于writethrough缓存:通过将设备的耐久性设置为0，它可以用作缓存，并且只用作缓存——bcachefs不会将该设备上的副本计入我们应该保留的副本数量。

## 2.3 Reflink（数据块共享）
Bcachefs支持reflink，类似于具有相同特性的其他文件系统。cp -reflink将创建一个共享底层存储的副本。从该文件读取将变得稍微慢一些——指向该数据的区段被移动到refink b树中(添加了一个refcount)，并且在区段b树中我们留下一个指向refink b树中间接区段的键，这意味着我们现在必须执行两次b树查找才能从该数据读取，而不是一次。
## 2.4 内联数据extents
Bcachefs支持内联数据区段，由`inline_data`选项控制(默认为on)。当写入文件的末尾小于文件系统块大小的一半时，它将作为内联数据区段写入。内联数据区段也可以被重新链接(在添加了一个重新链接计数的情况下移动到reflink btree中):作为待办事项，我们还打算支持压缩的内联数据区段。
## 2.5 子卷和快照
Bcachefs支持子卷和快照，具有与btrfs相似的用户空间界面。新的子卷可以创建为空，也可以作为另一个子卷的快照创建。快照是可写的，并且可以被再次快照，创建一个快照树。

创建快照的成本非常低:它们不像btrfs那样基于克隆COW b树，而是基于b树中单个键的版本控制。可以创建成千上万或数百万个快照，唯一的限制是磁盘空间。

用于管理子卷和快照的子命令如下:   

- bcachefs subvolume create:创建一个新的空子卷

- bcachefs subvolume destroy:删除已存在的子卷或快照

- bcachefs subvolume snapshot:为已存在的子卷创建快照

  在删除所有内容之后，也可以使用普通的rmdir命令删除子卷，例如使用rm -rf。仍然需要实现:只读快照，递归快照创建，以及递归列出子卷的方法。
## 2.6 Quotas(配额)
Bcachefs支持常规的用户/组/项目配额。配额目前并不应用于快照子卷，因为如果一个文件在快照中改变了所有权，那么该文件中的配额数据应该被计入哪些数据将是不明确的。

当目录设置了项目ID时，它将在创建和重命名时由后代自动继承。当重命名目录会导致项目ID更改时，我们返回-EXDEV，以便逐个文件进行移动，以便将项目ID正确地传播给后代-因此，项目配额可以用作子目录配额。

# 3 管理
## 3.1 格式化
要格式化新的 bcachefs 文件系统，请使用子命令 `bcachefs format`或 `mkfs.bcachefs`。所有持久文件系统范围的选项都可以在格式化时指定。举个例子 具有压缩、加密、复制功能的多设备文件系统和写回缓存：
```sh
bcachefs format --compression=lz4               \
                --encrypted                     \
                --replicas=2                    \
                --label=ssd.ssd1 /dev/sda       \
                --label=ssd.ssd2 /dev/sdb       \
                --label=hdd.hdd1 /dev/sdc       \
                --label=hdd.hdd2 /dev/sdd       \
                --label=hdd.hdd3 /dev/sde       \
                --label=hdd.hdd4 /dev/sdf       \
                --foreground_target=ssd         \
                --promote_target=ssd            \
                --background_target=hdd
```
## 3.2 挂载
要挂载多设备文件系统，有两个选项。您可以 指定所有组件设备，用连字符分隔，例如：
```sh
mount -t bcachefs /dev/sda:/dev/sdb:/dev/sdc /mnt
```
或者，使用 mount.bcachefs 工具按文件系统 UUID 挂载。todo：改进 mount.bcachefs 工具，支持按文件系统标签挂载。

unclean关机后的恢复不需要特殊处理。日志会自动recovering，dmesg日志中的诊断消息将指示恢复是从干净关机还是不干净关机进行的。

`-o degraded`选项将允许在没有所有设备的情况下挂载文件系统，但如果数据丢失将失败。`-o very_degraded`可用于在数据丢失时尝试挂载。

同样相关的还有`-o nochanges`选项。它禁止对底层设备进行任何或所有的写操作，必要时将脏数据固定在内存中(例如，如果需要日志重放)——可以将其视为“super read-only”模式。它可以用于数据恢复和版本升级测试。

`-o verbose`在挂载过程中启用额外的日志输出。

## 3.3 检查文件系统完整性
可以在用户空间中使用`bcachefs fsck`子命令(也可以使用fsck.bcachefs，或通过指定`-o fsck挂载选项在内核中挂载时。在这两种情况下，运行的都是完全相同的fsck实现，只是环境不同。在挂载时在内核中运行fsck具有更好的性能，而在用户空间中运行可以使用ctrl-c停止，并且可以提示用户修复错误。要在内核中运行fsck时修复错误，请使用`-o fix_errors`选项。   
传递给fsck的`-n`选项意味着`-o nochanges`选项;`bcachefs fsck -ny`可以用来测试在dry-run模式下的文件系统修复。

## 3.4 数据状态
`bcachefs fs usage <mountpoint> `可用于以各种方式显示文件系统的使用情况。数据使用情况按类型划分:超级块、日志、b树、数据、缓存数据和奇偶校验，以及跨哪些设备区段组进行复制。我们还给出了每个设备的使用情况，其中包括由于部分使用桶而产生的碎片。

## 3.5 日志（Journal）
日志有许多影响文件系统性能的可选项。日志提交是相当昂贵的操作，因为它们需要向底层设备发出FLUSH和FUA操作。默认情况下，我们在文件系统更新完成后一秒发出日志刷新;这是由`journal_flush_delay`选项控制的，该选项接受一个以毫秒为单位的参数。

文件系统sync和fsync操作会触发日志刷新;这可以通过`journal_flush_disabled`选项禁用——`journal_flush_delay`选项仍然适用，并且在系统崩溃的情况下，我们将永远不会丢失超过(默认情况下)一秒钟的工作。此选项在个人工作站或笔记本电脑上可能很有用，而在服务器上可能不太合适。

日志回收线程在后台运行，启动b树节点写入和b树键缓存刷新，以释放日志中的空间。即使在没有空间压力的情况下，它也会在后台缓慢运行:这是由`journal_reclaim_delay`参数控制的，默认值为100毫秒。

日志的大小应该足够大，这样突发的活动不会太快填满日志;此外，更大的日志意味着我们可以排队进行更大的b树写操作。bcachefs设备`resize-journal`可用于调整特定设备上磁盘上的日志大小——它可用于已挂载或未挂载的文件系统。

在将来，我们应该实现一个方法来查看当前在日志中使用了多少空间。   

## 3.6 设备管理
### 3.6.1 文件系统大小调整
可以在特定设备上调整文件系统的大小，使用`bcachefs device resize`子命令。目前只有增长 支持，而不是收缩。 
### 3.6.2 设备添加/删除
存在以下子命令，用于在挂载的文件系统：
- bcachefs device add:将新设备格式化并添加到现有的文件系统中。
- bcachefs device remove:从现有文件系统中永久删除一个设备。
- bcachefs device online:将一个设备连接到一个正在运行的文件系统，这个文件系统是在没有它的情况下挂载的(即在降级模式下)。
- bcachefs device offline:将设备与挂载的文件系统断开连接而不移除它。
- bcachefs device evacuation:将数据从特定设备迁移出去，为删除做准备，必要时将其设置为只读。
- bcachefs device set-state:修改成员设备的状态:rw(读写)、ro(只读)、failed或spare。   
一个失败的设备被认为具有0持久性，并且该设备上的副本不会被计算到一个extent应该拥有的副本数量中——然而，bachefs仍然会尝试从标记为失败的设备中读取数据。
`bcachefs device remove`、`bcachefs device offline`和`bcachefs device set-state`命令在以下情况下采用强制选项会使文件系统降级或数据丢失。待办事项： 规范化和改进这些选项。
## 3.7 数据管理
### 3.7.1 数据复制
这`bcachefs data rereplicate`命令可用于扫描副本不足的区，并写入额外的副本，例如，在从文件系统中删除设备或启用或增加复制之后。
### 3.7.2 再平衡（Rebalance）
待实现:用于在设备之间移动数据以平衡每个设备上的使用情况的命令。通常不需要，因为分配器会尝试平衡设备间的使用情况，但在某些情况下可能是必要的——例如，当启用了复制的双设备文件系统非常满时，添加了第三个设备。
### 3.7.3 Scrub
待实现：用于读取文件系统中所有数据的命令 并确保校验和有效，在有效副本时修复 bitrot 可以找到。

# 4 Advanced
## 4.1 可选项（Options）
大多数bcachefs选项都可以在文件系统范围内设置，还可以在inode(文件和目录)上设置一个重要的子集，覆盖全局默认值。文件系统范围选项可以在格式化时设置，在挂载时设置，或者在运行时通过`/sys/fs/bcachefs/<uuid>/options/`设置。当在运行时通过sysfs设置时，superblock中的persistent选项也会被更新;当选项作为挂载参数传递时，持久性选项不会被修改。
### 4.1.1 文件和目录可选项
\<说明如何通过bcachefs的attr命令设置attrs \>

在inode(文件和目录)上设置的选项由它们的后代自动继承，并且inode还记录给定的选项是显式设置还是从它们的父节点继承。当重命名目录会导致继承的属性发生变化时，我们使用-EXDEV失败重命名，导致用户空间逐个文件重命名，以便继承的属性保持一致。

Inode选项作为扩展属性可用。已显式设置的选项在bcachefs命名空间下可用，有效选项(显式设置和继承的选项)在`bcachefs_effective`命名空间下可用。使用getfattr命令列出选项的示例:

```sh
$ getfattr -d -m '^bcachefs\.' filename
$ getfattr -d -m '^bcachefs_effective\.' filename
```
选项可以通过扩展属性接口设置，但最好使用`bcachefs setattr`命令，因为它将正确地递归传播选项。   
### 4.1.2 完整选项列表
- `block_size`: format 
  文件系统块大小 (默认 4k)

- `btree_node_size`: format 

  Btree node 大小 （默认 256k）

- `errors`: format,mount,rutime 

  对文件系统错误采取的操作

- `metadata_replicas`： format,mount,runtime 

  元数据(日志和b树)的副本数

- `data_replicas`： format,mount,runtime,inode

  用户数据的副本数

- `replicas`： format

  metadata_replicas 和 data_replicas的别名

- `metadata_checksum`： format,mount,runtime

  元数据写入的校验和类型

- `data_checksum`： format,mount,runtime,inode

  元数据写入的校验和类型

- `compression`： format,mount,runtime,inode

  压缩类型 

- `background_compression`： format,mount,runtime,inode

  后端压缩类型

- `str_hash`： format,mount,runtime,inode

  字符串哈希表(目录和xattrs)的哈希函数

- `metadata_target`： format,mount,runtime,inode

  元数据写入的首选目标

- `foreground_target`： format,mount,runtime,inode

  前台写的首选目标

- `background_target`： format,mount,runtime,inode

  要在后台移动到的数据的目标

- `promote_target`： format,mount,runtime,inode

  读取时要复制到的数据的目标

- `erasure_code`： format,mount,runtime,inode

  启用纠删码（EC）

- `inodes_32bit` format,mount,runtime

  限制新的inode为32位

- `shard_inode_numbers`: format,mount,runtime

  使用CPU id表示新inode号的高位数

- `wide_macs`: format,mount,runtime

  存储完整的128位加密mac(默认80位)

- `inline_data`: format,mount,runtime

  启用内联数据区段(默认为开启)

- `journal_flush_delay`: format,mount,runtime

  自动日志提交前的毫秒延迟(默认为1000)

- `journal_flush_disabled`: format,mount,runtime

  在sync/fsync上禁用日志刷新。Journal_flush_delay仍然有效，因此在默认设置下，不会丢失超过1秒的工作。

- `journal_reclaim_delay`：format,mount,runtime

  自动日志回收前的延迟(以毫秒为单位)

- `acl`： format,mount

  启用 POSIX ACLs

- `usrquota`： format,mount

  启用用户配额

- `grpquota`： format,mount

  启用组配额

- `prjquota`： format,mount

  启用项目配额

- `degraded`： mount

  允许在数据降级的情况下挂载

- `very_degraded`： mount

  允许在丢失数据的情况下安装

-  `verbose`： mount

  挂载/恢复期间的额外调试信息

- `fsck`： mount

  在挂载期间运行fsck

- `fix_errors`： mount
  在fsck期间无需询问即可修复错误

- `ratelimit_errors`： mount
  fsck期间的速率限制错误消息

- `read_only`： mount
  以只读模式挂载

- `nochanges`： mount
  不写，即使是日志重放

- `norecovery`： mount
  不要replay日志(不推荐)

- `noexcl`： mount
  不要以独占模式打开设备

- `version_upgrade`： mount
  将磁盘格式升级到最新版本

- `discard`： device
  启用discard/TRIM支持

### 4.1.3 错误时行为([`--errors`](https://man.archlinux.org/man/bcachefs.8.en#errors))

这  `errors` option 用于表示某些 有点像一个错误。有效的错误操作包括：

- `continue`

  记录错误，但继续正常操作 

- `ro`

  紧急只读，立即停止对磁盘上的文件系统 

- `panic`

  立即停止整个机器，在系统控制台

### 4.1.4 校验和类型([`--metadata_checksum`](https://man.archlinux.org/man/bcachefs.8.en#metadata_checksum~2) or [`--data_checksum`](https://man.archlinux.org/man/bcachefs.8.en#data_checksum~2))

有效校验和类型： `none`,  `crc32c`(default), crc64

### 4.1.5 压缩类型([`--compression`](https://man.archlinux.org/man/bcachefs.8.en#compression~2))

有效压缩类型：`none`(default), lz4, gzip, zstd

### 4.1.6 字符串哈希类型([`--str_hash`](https://man.archlinux.org/man/bcachefs.8.en#str_hash~2))

`crc32c`, `crc64`, `siphash`(default)

## 4.2 调试工具

### 4.2.1 sysfs接口

挂载的文件系统在 sysfs 中可用，地址为 `/sys/fs/bcachefs/<uuid>/` 具有各种选项，性能计数器 和内部调试辅助工具。 

#### 4.2.1.1 可选项

可以通过以下方式查看和更改文件系统选项`/sys/fs/bcachefs/<uuid>/options/`，并且通过sysfs更改的设置也会在超级块中持久化更改。

#### 4.2.1.2 时间统计

Bcachefs跟踪各种操作和事件的延迟和频率，在`/sys/fs/ Bcachefs /\<uuid>/time_stats/`目录中使用latency/duration的分位数。

- `blocked_allocate`

  分配桶时的跟踪必须等待，因为没有立即可用的跟踪，这意味着copygc线程没有及时清除大部分空桶，或者分配器线程没有及时使桶无效并丢弃桶。

- `blocked_allocate_open_bucket`

  分配桶时的跟踪必须等待，因为我们所有用于固定打开桶的句柄都在使用中(我们静态分配1024)。

- `blocked_journal`

  当获得日志预留时，跟踪必须等待，要么是因为日志回收跟不上日志空间回收的速度，要么是因为日志写需要很长时间才能完成，而我们已经有太多的日志在运行。

- `btree_gc`

  跟踪btree_gc代码在运行时必须遍历btree——以便重新计算b树中每个桶的最老的未完成世代数。

- `btree_lock_contended_read`、`btree_lock_contended_intent`、`btree_lock_contended_write`

  当在b树节点上读、意图或写锁时，跟踪必须阻塞。

- `btree_node_mem_alloc`

  跟踪在b树节点缓存中为新b树节点分配内存的总时间。

- `btree_node_split`

  跟踪b树节点分裂——当一个b树节点满并分裂成两个新节点时

- `btree_node_compact`

  跟踪b树节点压缩——当b树节点满了，需要在磁盘上进行压缩时。

- `btree_node_merge`

  跟踪两个相邻b树节点合并

- `btree_node_sort`

  跟踪排序并在内存中调用整个b树节点，无论是在从磁盘读取它们之后，还是在创建新的排序键数组之前进行压缩。

- `btree_node_read`

  跟踪从磁盘读取b树节点。

- `btree_interior_update_foreground`

  跟踪改变 btree 拓扑的 btree 更新的前台时间 -- 即b树节点拆分、压缩和合并;测量的持续时间大致对应于锁持有时间。

- `btree_interior_update_total`

  跟踪完成拓扑更改b树更新的时间;首先，它们有一个前台部分，用于更新内存中的b树节点，然后在写入新节点之后，有一个事务阶段，记录对内部节点或新的b树根的更新以及对alloc btree更改。

- `data_read`

  跟踪核心读路径——在extents(也可能是refink) b树中查找请求，必要时分配bounce缓冲区，发出读，校验和，解压缩，解密和交付完成。

- `date_write`

  跟踪核心写路径——在磁盘上为新写分配空间，必要时分配bounce缓冲区，压缩、加密、校验和、发出写，以及更新区b树以指向新数据。

- `data_promote`

  跟踪提升操作，这发生在读操作将区段的额外缓存副本写入`promote_target`时。这是从原始读取异步完成的。

- `journal_flush_write`

  跟踪写入磁盘的刷新日志项，它首先向底层设备发出缓存刷新操作，然后将日志写入作为FUA写入。时间跟踪从所有日记账保留已释放其参考文献或完成前一次日记账写入之后开始。

- `journal_noflush_write`

  跟踪对磁盘的non-flush日志条目的写入，这些条目不发出缓存刷新或FUA写入。

- `journal_flush_seq`

  跟踪通过文件系统sync和fsync操作将日志序列号刷新到磁盘的时间，以及在没有不需要刷新的桶可用时重用桶之前的分配器。

#### 4.2.1.3 内部（Internals）

- `btree_cache`

  显示有关btree节点缓存的信息:缓存节点的数量、脏节点的数量以及是否持有cannibalize锁(用于回收缓存节点以分配新节点)。

- `dirty_btree_nodes`

  打印与内部b树节点更新机制相关的信息，该机制负责确保依赖的b树节点写入的顺序正确。

  对于每个脏 btree 节点，打印： 

  - 是否设置  `need_write` 标志
  - btree 节点的级别 
  - 写入的扇区数 
  - 写入此节点是否被阻塞，等待其他节点写入
  - 是否正在等待btree_update完成并使其在磁盘上可访问

- `btree_key_cache`

  在 btree 密钥缓存上打印信息：释放的密钥数 （必须等待 sRCU 屏障完成，然后才能完成 freed）、缓存键数和脏键数。 

- `btree_transactions`

  列出拥有锁的每个正在运行的btree事务，列出它们锁定的节点和锁的类型，进程试图锁定的节点(如果有的话)，以及从何处调用btree事务。

- `btree_updates`

  列出未完成的内部b树更新:模式(还没有更新，或者更新了一个b树节点，或者写了一个新的b树根，或者被另一个b树更新重新包含)，它的新b树节点是否已经完成写入，它的嵌入closure的refcount(当非零时，b树更新仍在等待)，以及固定的日志序列号。

- `journal_debug`

  打印各种内部日志状态。

- `journal_pins`

  列出固定日志账条目的项，防止它们被回收。

- `new_stripes`

  列出正在创建的新erasure-coded条带。

- `stripes_heap`

  列出可重用的erasure-coded条带。

- `open_buckets`

  列出当前正在写入的存储桶，以及数据类型和refcount。

- `io_timers_read`、`io_timers_write`

  列出未完成的IO定时器——等待对文件系统的全部读或写的定时器。

- `trigger_journal_flush`

  回显该文件将触发日志提交。

- `trigger_gc`

  回显此文件将导致GC代码重新计算每个桶的oldest_gen字段。

- `prune_cache`

  回显此文件将修剪b树节点缓存。

- `read_realloc_races`

  这将统计读取路径读取区段并发现在IO运行期间被重用的桶，从而导致重试读取的事件。

- `extent_migrate_done`

  这将计算由copygc和rebalance使用的核心移动路径移动的extents。

- `extent_migrate_raced`

  这将计算移动路径尝试移动但在执行最后的b树更新时不再存在的extents。

#### 4.2.1.4 单元和性能测试

回显到`sys/fs/bcachefs/<uuid>/perf_test`中运行各种低层btree测试，其中一些用作单元测试，另一些用作性能测试。语法是

```sh
echo <test_name> <nr_iterations> <nr_threads> > perf_test
```

完成后，经的时间将打印到dmesg日志中。可以运行的测试的完整列表可以在`fs/bcachefs/tests.c`的底部找到。

### 4.2.2 debugfs接口

在`/sys/kernel/debug/bcachefs/<uuid>/`目录下可以找到每个btree的内容，以及各种内部的每个btree节点的信息。

对于每个b树，我们有以下文件:

- *btree_name*

  整个b树内容，每行一个键

- *btree_name*`-formats`

  关于每个b树节点的信息：打包bkey格式的大小，每个b树节点的满度，打包和解打包键的数量，以及内存中搜索树中的节点和失败节点的数量。

- *btree_name*`-bfloat-failed`

  对于b树节点中每一个排序好的键集，我们构造了一个压缩键的eytzinger布局的二叉搜索树。有时我们无法构建正确的压缩搜索键，这会导致查找速度变慢;该文件列出了导致这些失败节点的密钥。

### 4.2.3 列出和转储文件系统元数据

#### 4.2.3.1 bcachefs show-super

该子命令用于检查和打印bcachefs超级块。它接受两个可选参数:
`-l`：打印超级块布局，记录为超级块保留的空间大小和备份超级块的位置。
`-f, -fields=(fields)`:要打印的超级块部分列表，`all`打印所有部分。

#### 4.2.3.2 bcachefs list

该子命令提供与debugfs接口相同的功能，列出b树节点和内容，但适用于脱机文件系统。

#### 4.2.3.3 bcachefs list_journal

这个子命令列出日志的内容，日志主要记录按发生时间排序的b树更新。

#### 4.2.3.4 bcachefs dump

这个子命令可以将文件系统(包括多设备文件系统)中的所有元数据转储为qcow2映像:当遇到fsck无法恢复并且需要开发人员注意的问题时，这使得只向开发人员发送所需的元数据成为可能。加密的文件系统必须首先使用`bcachefs remove-passphrase`解锁。

## 4.3 ioctl接口

本节介绍特定于 bcachefs 的 ioctls： 

- `BCH_IOCTL_QUERY_UUID`

  返回文件系统的 UUID：用于查找 sysfs 目录给定挂载文件系统的路径。 

- `BCH_IOCTL_FS_USAGE`

  查询文件系统使用情况，通过`bch_replicas`条目返回全局计数器和计数器列表。

- `BCH_IOCTL_DEV_USAGE`

  查询特定设备的使用情况，如按数据类型划分的桶和扇区计数。

- `BCH_IOCTL_READ_SUPER`

  返回文件系统超级块，以及给定设备索引的特定设备的可选超级块。

- `BCH_IOCTL_DISK_ADD`

  给定设备的路径，将其添加到已安装并正在运行的文件系统中。设备必须已经有一个bachefs超级块;从新设备的超级块中读取选项和参数，并将其添加到现有文件系统超级块的成员信息部分。

- `BCH_IOCTL_DISK_REMOVE`

  给定设备或设备索引的路径，试图将其从已挂载并正在运行的文件系统中删除。此操作需要遍历b树以删除对该设备的所有引用，如果数据降级或丢失，则可能失败，除非设置了适当的强制标志。

- `BCH_IOCTL_DISK_ONLINE`

  给定一个设备的路径，该设备是正在运行的文件系统的成员(在降级模式下)，使其重新联机。

- `BCH_IOCTL_DISK_OFFLINE`

  给定多设备文件系统中某个设备的路径或设备索引，尝试关闭它而不删除它，以便稍后可以重新添加该设备，并且其内容仍然可用。

- `BCH_IOCTL_DISK_SET_STATE`

  给定多设备文件系统中设备的路径或设备索引，尝试将其状态设置为读写、只读、失败或备用。如果文件系统降级，则强制使用标志。

- `BCH_IOCTL_DATA`

  启动一个数据作业，遍历文件系统中的所有数据和/或元数据，在每个b树节点和区段上执行一些操作。返回一个文件描述符，可以从中读取以获取作业的当前状态，关闭文件描述符(即在进程退出时)会停止数据作业。

## 4.4 在磁盘格式上

### 4.4.1 超级块

超级块是访问bachefs文件系统时首先要读取的内容。它位于距离设备开始4kb的地方，在其他地方有冗余副本——通常一个在第一个超级块之后，一个在设备的末尾。

`bch_sb_layout`记录为超级块保留的空间量以及所有超级块的位置。它包含在每个超级块中，并且从设备开始额外写入3584字节(在第一个超级块之前512字节)。

大多数超级块在每个设备上都是相同的。例外情况是`dev_idx`字段和给出日志位置的journal部分。

超级块的主要部分包含uuid、版本号、文件系统内的设备数量和设备索引、块大小、文件系统创建时间以及各种选项和设置。超级块也有一些可变长度的部分:

- `BCH_SB_FIELD_journal`

  此设备上用于日志的存储桶列表。

- `BCH_SB_FIELD_members`

  成员设备的列表，以及每个设备的选项和设置，包括桶大小、桶数量和上次挂载的时间。

- `BCH_SB_FIELD_crypt`

  包含主chacha20加密密钥，由用户的密码短语加密，以及密钥派生功能设置。

- `BCH_SB_FIELD_replicas`

  包含复制项列表，这些复制项是具有跨它们复制的区段的设备列表。

- `BCH_SB_FIELD_quota`

  包含每个配额类型(用户、组和项目)和计数器(空间、索引节点)的timelimit和warnlimit字段。

- `BCH_SB_FIELD_disk_groups`

  以前称为磁盘组(在整个代码中仍然如此);该部分包含设备标签字符串，并记录标签路径的树结构，允许被解析后的标签通过目标选项的整数ID引用。

- `BCH_SB_FIELD_clean`

  当文件系统是干净的，这个部分包含一个日志条目列表，这些条目通常是用每个日志写(`struct jset`): btree roots来写的，以及文件系统使用情况和读/写计数器(向这个文件系统读/写的数据总量)。这允许在完全关机后跳过读取日志。

### 4.4.2 日志

每个日志写入(`struct jset`)包含一个条目列表:下面列出了不同的日志条目类型。

- `BCH_JSET_ENTRY_btree_key`

  此条目类型用于记录发生的每个b树更新。它包含一个或多个b树键(`struct bkey`)， `jset_entry`的`btree_id`和`level`字段记录了键所属的btree ID和级别。

- `BCH_JSET_ENTRY_btree_root`

  此条目类型用于指向btree root，在当前的实现中，每个日志写入仍然记录每个btree根，尽管这可能会发生变化。btree根是`KEY_TYPE_btree_ptr_v2`类型的bkey,`jset_entry`的`btree_id`和`level`字段记录了btree的ID和深度。

- `BCH_JSET_ENTRY_clock`

  记录IO时间，而不是挂钟时间——即，自文件系统创建以来，在512字节扇区中读取和写入的数量。

- `BCH_JSET_ENTRY_usage`

  用于某些持久计数器:索引节点数、当前最大键版本和持久保留扇区。

- `BCH_JSET_ENTRY_data_usage`

  在扇区中使用计数器存储副本条目。

- `BCH_JSET_ENTRY_dev_usage`

  存储每个设备的使用计数器:使用的扇区和使用的桶，按每种数据类型划分。

### 4.4.3 Btree

### 4.4.4  Btree keys
