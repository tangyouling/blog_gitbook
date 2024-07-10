# <p align="center">kasan原理分析</p>

## 简介

KASAN 是 `Kernel Address Sanitizer` 的缩写，它是一个动态检测内存错误的工具，主要功能是检查内存越界访问和使用已释放的内存等问题。KASAN 集成在 Linux 内核中，随 Linux 内核代码一起发布，并由内核社区维护和发展。

## 原理

### 1. KASAN是如何实现检测的？

KASAN利用额外的内存标记可用内存的状态，这部分额外的内存被称作`shadow memory`（影子区）。在我们Linux内核中有page结构体（页描述符），用来标识物理内存页，每个页面都需要一个page结构体来进行描述，除此之外还有大量的用来描述各类结构的结构体，这些用于描述各类结构的结构体会占用一定量的内存。同样的KASAN也使用额外的内存来对内存使用进行标记（即内存的合法检测以内存空间作为代价）。

KASan将`1/8`的内存用作shadow memory。KANsan使用特殊的`magic num`填充shadow memory，在每一次**load/store内存**的时候检测对应的shadow memory确定操作是否valid。连续8 bytes内存（8 bytes align）使用1 byte shadow memory标记。如果8 bytes内存都可以访问，则shadow memory的值为0；如果连续N(1 =< N <= 7) bytes可以访问，则shadow memory的值为N；如果8 bytes内存访问都是invalid，则shadow memory的值为负数。

![1.png](http://www.wowotech.net/content/uploadfile/201802/4a471518360139.png)

在代码运行时，每一次memory access都会检测对应的shawdow memory的值是否valid。这就需要编译器为我们做些工作。编译的时候，在每一次memory access前编译器会帮我们插入**__asan_load##size()**或者**__asan_store##size()**函数调用（size是访问内存字节的数量）。

```assembly
load:
900000000022007c:       57b9ac0b        bl              3127724(0x2fb9ac)       # 900000000051ba28 <__asan_load8>
9000000000220080:       28c042e5        ld.d            $a1, $s0, 16(0x10)

store:
9000000000220e78:       57a6e40b        bl              3122916(0x2fa6e4)       # 900000000051b55c <__asan_store4>
9000000000220e7c:       2980f2f8        st.w            $s1, $s0, 60(0x3c)

```

`__asan_load##size()`和`__asan_store##size()`的代码在mm/kasan/kasan.h文件声明，在mm/kasan/generic.c定义。

```c
#define DEFINE_ASAN_LOAD_STORE(size)                                    \
        void __asan_load##size(unsigned long addr)                      \
        {                                                               \
                check_region_inline(addr, size, false, _RET_IP_);       \
        }                                                               \
        EXPORT_SYMBOL(__asan_load##size);                               \
        __alias(__asan_load##size)                                      \
        void __asan_load##size##_noabort(unsigned long);                \
        EXPORT_SYMBOL(__asan_load##size##_noabort);                     \
        void __asan_store##size(unsigned long addr)                     \
        {                                                               \
                check_region_inline(addr, size, true, _RET_IP_);        \
        }                                                               \
        EXPORT_SYMBOL(__asan_store##size);                              \
        __alias(__asan_store##size)                                     \
        void __asan_store##size##_noabort(unsigned long);               \
        EXPORT_SYMBOL(__asan_store##size##_noabort)

DEFINE_ASAN_LOAD_STORE(1);
DEFINE_ASAN_LOAD_STORE(2);
DEFINE_ASAN_LOAD_STORE(4);
DEFINE_ASAN_LOAD_STORE(8);
DEFINE_ASAN_LOAD_STORE(16);
```

其中即调用的`check_region_inline()`

```c
static __always_inline bool check_region_inline(unsigned long addr,
						size_t size, bool write,
						unsigned long ret_ip)
{
	if (!kasan_arch_is_ready())
		return true;

	if (unlikely(size == 0))
		return true;

	if (unlikely(addr + size < addr))
		return !kasan_report(addr, size, write, ret_ip);

	if (unlikely(!addr_has_metadata((void *)addr)))
		return !kasan_report(addr, size, write, ret_ip);

	if (likely(!memory_is_poisoned(addr, size)))
		return true;

	return !kasan_report(addr, size, write, ret_ip);
}
```

### 2. 如何根据shadow memory的值判断内存访问操作是否valid？

shadow memory检测原理的实现主要就是__asan_load##size()和__asan_store##size()函数的实现。那么KASAN是如何根据访问的address以及对应的shadow memory的状态值来判断访问是否合法呢？首先看一种最简单的情况。访问8 bytes内存。

long *addr = (long *)0xffff800012345678;
*addr = 0;

以上代码是访问8 bytes情况，检测原理如下：

long *addr = (long *)0xffff800012345678;

char *shadow = (char *)(((unsigned long)addr >> 3) + KASAN_SHADOW_OFFSE);
if (\*shadow)
  report_bug();
*addr = 0;

红色区域类似是编译器插入的指令。既然是访问8 bytes，必须要保证对应的shadow mempry的值必须是0，否则肯定是有问题。那么如果访问的是1,2 or 4 bytes该如何检查呢？也很简单，我们只需要修改一下if判断条件即可。修改如下：
if (*shadow && *shadow < ((unsigned long)addr & 7) + N); //N = 1,2,4
如果*shadow的值为0代表8 bytes均可以访问，自然就不需要report bug。addr & 7是计算访问地址相对于8字节对齐地址的偏移。还是使用下图来说明关系吧。假设内存是从地址8~15一共8 bytes。对应的shadow memory值为5，现在访问11地址。那么这里的N只要大于2就是invalid。![2.png](http://www.wowotech.net/content/uploadfile/201802/fb5c1519483501.png)

实际函数为`memory_is_poisoned()`

```c
static __always_inline bool memory_is_poisoned(unsigned long addr, size_t size)
{
	if (__builtin_constsant_p(size)) {
		switch (size) {
		case 1:
			return memory_is_poisoned_1(addr);
		case 2:
		case 4:
		case 8:
			return memory_is_poisoned_2_4_8(addr, size);
		case 16:
			return memory_is_poisoned_16(addr);
		default:
			BUILD_BUG();
		}
	}

	return memory_is_poisoned_n(addr, size);
}
```

以`memory_is_poisoned_n`为例，

```c
static __always_inline bool memory_is_poisoned_n(unsigned long addr,
						size_t size)
{
	unsigned long ret;

	ret = memory_is_nonzero(kasan_mem_to_shadow((void *)addr),
			kasan_mem_to_shadow((void *)addr + size - 1) + 1);

	if (unlikely(ret)) {
		unsigned long last_byte = addr + size - 1;
		s8 *last_shadow = (s8 *)kasan_mem_to_shadow((void *)last_byte);

		if (unlikely(ret != (unsigned long)last_shadow ||
			((long)(last_byte & KASAN_GRANULE_MASK) >= *last_shadow)))
			return true;
	}
	return false;
}
```

```c
((long)(last_byte & KASAN_GRANULE_MASK) >= *last_shadow)
以上图为例子：
假设要访问的addrh地址值为11，其中访问长度size为4。
last_byte = 11 + 4 - 1 = 14;
last_byte & KASAN_GRANULE_MASK = last_byte & (1 << 3 - 1) = 14 & 7 = 6
*last_shadow = 5;
所以return ture;
返回true会进入kasan_report(),代表非法。

如果size为2：
12 & 7 = 4 < 5 合法

如果size为3：
13 & 7 = 5 >= 5 非法
```

### 3. shadow memory内存如何分配？

shadow memory内存布局由`kasan_mem_to_shadow()`决定。

LoongArch架构需要单独实现kasan_mem_to_shadow的原因是虚拟地址布局空洞太多，而其他几个主流的架构现有布局都是连续的。

```c
//除LoongArch架构外的其他架构
static inline void *kasan_mem_to_shadow(const void *addr)
{
	return (void *)((unsigned long)addr >> KASAN_SHADOW_SCALE_SHIFT)
		+ KASAN_SHADOW_OFFSET;
}

//LoongArch架构
需要选上__HAVE_ARCH_SHADOW_MAP
static inline void *kasan_mem_to_shadow(const void *addr)
{
	if (kasan_early_stage) {
		return (void *)(kasan_early_shadow_page);
	} else {
		unsigned long maddr = (unsigned long)addr;
		unsigned long xrange = (maddr >> XRANGE_SHIFT) & 0xffff;
		unsigned long offset = 0;

		maddr &= XRANGE_SHADOW_MASK;
		switch (xrange) {
		case XKPRANGE_CC_SEG:
			offset = XKPRANGE_CC_SHADOW_OFFSET;
			break;
		case XKPRANGE_UC_SEG:
			offset = XKPRANGE_UC_SHADOW_OFFSET;
			break;
		case XKVRANGE_VC_SEG:
			offset = XKVRANGE_VC_SHADOW_OFFSET;
			break;
		default:
			WARN_ON(1);
			return NULL;
		}

		return (void *)((maddr >> KASAN_SHADOW_SCALE_SHIFT) + offset);
	}
}

//2a86f1b56a30 ("kasan: Cleanup the __HAVE_ARCH_SHADOW_MAP usage")之后移除了__HAVE_ARCH_SHADOW_MAP，但原理还是保持不变。
```

## 文档及参考链接

https://github.com/torvalds/linux/blob/master/Documentation/dev-tools/kasan.rst

https://github.com/torvalds/linux/blob/master/Documentation/translations/zh_CN/dev-tools/kasan.rst

http://www.wowotech.net/memory_management/424.html

https://www.cnblogs.com/linhaostudy/p/14028917.html

https://zhuanlan.zhihu.com/p/523513468