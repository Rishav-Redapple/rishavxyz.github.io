# Binary Executables: Structure and Inspection of ELF and Mach-O

Operating systems execute compiled binaries daily. Common examples include `git`, Go or Rust microservices, C++ native runtime extensions, and shell utilities. These tools run machine code packaged inside operating system binary formats.

A compiled binary file often appears as an opaque stream of hexadecimal bytes. Execution failures such as `Segmentation fault`, `relocation error: symbol not found`, or `Exec format error` relate directly to internal binary structures.

This document describes executable binary formats. It covers file headers, sections, segments, symbol tables, dynamic linking, and inspection utilities (`readelf`, `objdump`, `nm`, `strings`).

---

## 1. Magic Bytes and File Headers

Executable files start with identifier bytes known as **Magic Numbers**. The operating system kernel checks these bytes during an `execve` system call to select the matching binary loader:

- **Linux & BSD (ELF):** `7F 45 4C 46` (`.ELF`)
- **macOS & iOS (Mach-O):** `CF FA ED FE` or `FE ED FA CF` (architecture dependent)
- **Windows (PE):** `4D 5A` (`MZ` — initials of DOS architect Mark Zbikowski)

### ELF Header Layout on Linux

The first 16 bytes of an ELF binary display standard identifier fields:

```bash
$ xxd -l 16 /bin/ls
00000000: 7f45 4c46 0201 0100 0000 0000 0000 0000  .ELF............
```

These bytes communicate metadata to the Linux kernel:

- `7f 45 4c 46`: Standard ELF magic sequence.
- `02`: Architecture class. `01` designates 32-bit; `02` designates 64-bit.
- `01`: Endianness. `01` designates Little-Endian (LSB); `02` designates Big-Endian (MSB).
- `00`: Target Operating System ABI (`00` designates System V / generic Linux).

The `readelf -h` command outputs the parsed ELF header:

```bash
$ readelf -h /bin/ls
ELF Header:
  Magic:   7f 45 4c 46 02 01 01 00 00 00 00 00 00 00 00 00 
  Class:                             ELF64
  Data:                              2's complement, little endian
  Version:                           1 (current)
  OS/ABI:                            UNIX - System V
  Type:                              DYN (Position-Independent Executable file)
  Machine:                           Advanced Micro Devices X86-64
  Entry point address:               0x6710
  Start of program headers:          64 (bytes into file)
  Start of section headers:          136808 (bytes into file)
  Size of this header:               64 (bytes)
  Number of program headers:         13
  Number of section headers:         31
```

The **Entry point address** (`0x6710`) points to the first instruction executed by the CPU. Program execution does not start at `main()`. Execution begins at `_start`, a bootstrap routine from the C runtime (`crt1.o`). It configures input/output streams, environment variables, and allocators before calling `main()`.

---

## 2. Sections vs Segments

An executable binary provides two separate views:

1. **Link Time:** Compilers and linkers view the binary as a collection of **Sections**.
2. **Run Time:** The kernel loader views the binary as a collection of **Segments** described by **Program Headers**.

The operating system maps sections into runtime memory segments based on permissions:

- Executable instructions (`.text`) and constants (`.rodata`) group into a **Read + Execute** segment (`PT_LOAD`).
- Writable data (`.data`, `.bss`) groups into a **Read + Write** segment (`PT_LOAD`). Execution is disabled for security (W^X protection).
- Metadata (`.symtab`, `.strtab`) is omitted from runtime process memory. Stripping removes these tables from disk.

### Common Sections

- **`.text`:** Compiled machine instructions (Read / Execute).
- **`.rodata`:** Read-only data including string literals and constants (Read Only).
- **`.data`:** Initialized global and static variables (Read / Write).
- **`.bss`:** Uninitialized global variables. Takes **0 bytes on disk** and allocates zero-filled RAM pages at startup.
- **`.symtab` / `.strtab`:** Symbol and string tables mapping identifiers to binary offsets (strippable).

#### The Role of `.bss`

An uninitialized 100MB array in C (`char cache[100 * 1024 * 1024];`) does not add 100MB to the binary file on disk. The linker records an entry in `.bss` requesting 100MB of zero-filled memory when the program launches.

---

## 3. Binary Inspection Utilities

A sample C program demonstrates how symbols and sections behave:

```c
// demo.c
#include <stdio.h>

const char greeting[] = "Hello from binary!";
int global_counter = 100;
int uninitialized_slot;

int add(int a, int b) {
    return a + b;
}

int main() {
    int result = add(global_counter, 5);
    printf("%s %d\n", greeting, result);
    return 0;
}
```

Compilation with debug symbols:

```bash
$ gcc -O0 -g demo.c -o demo
```

### 1. `file`: High-Level Binary Triage

```bash
$ file demo
demo: ELF 64-bit LSB pie executable, x86-64, version 1 (SYSV), dynamically linked, interpreter /lib64/ld-linux-x86-64.so.2, for GNU/Linux 3.2.0, with debug_info, not stripped
```

Output fields:

- `pie executable`: Position Independent Executable (supports ASLR memory randomization).
- `dynamically linked`: Depends on external shared libraries (`libc.so.6`).
- `interpreter`: Path to the dynamic loader (`ld-linux`).
- `not stripped`: Function names and symbol maps remain inside the binary.

### 2. `readelf -S`: Listing All Sections

```bash
$ readelf -S demo
There are 31 section headers, starting at offset 0x3678:

Section Headers:
  [Nr] Name              Type             Address           Offset
  [14] .text             PROGBITS         0000000000001150  00001150
  [16] .rodata           PROGBITS         0000000000002000  00002000
  [24] .data             PROGBITS         0000000000004018  00003018
  [25] .bss              NOBITS           0000000000004028  00003028
```

Section `.bss` has type `NOBITS`. It occupies memory addresses at runtime (`0x00004028`), but requires zero disk space.

### 3. `strings`: Extracting Text Strings

The `strings` utility extracts printable text strings, endpoints, error messages, and version markers:

```bash
$ strings demo | grep "Hello"
Hello from binary!
```

### 4. `nm`: Reading the Symbol Table

The `nm` tool lists functions, global variables, and imported symbols:

```bash
$ nm demo
000000000004018 D global_counter
000000000002004 R greeting
000000000001149 T add
00000000000115f T main
                 U printf@@GLIBC_2.2.5
000000000004028 B uninitialized_slot
```

Symbol type indicators:

- **`T` / `t`**: Text section (executable code).
- **`D` / `d`**: Data section (initialized variable).
- **`B` / `b`**: BSS section (uninitialized variable).
- **`R` / `r`**: Read-only data section (`greeting`).
- **`U`**: Undefined symbol. The symbol is resolved at runtime by the dynamic linker from `libc`.

### 5. `objdump -d`: Disassembling Machine Code

The `objdump -d` command converts raw bytes from `.text` into assembly instructions:

```bash
$ objdump -d -M intel --no-show-raw-insn demo
```

Disassembly for `add`:

```nasm
0000000000001149 <add>:
    push   rbp
    mov    rbp, rsp
    mov    DWORD PTR [rbp-0x4], edi    ; Store first parameter (a)
    mov    DWORD PTR [rbp-0x8], esi    ; Store second parameter (b)
    mov    edx, DWORD PTR [rbp-0x4]
    mov    eax, DWORD PTR [rbp-0x8]
    add    eax, edx                    ; Execute addition instruction
    pop    rbp
    ret                                ; Return result in EAX
```

This disassembly shows how the C function translates into x86_64 register operations (`edi`, `esi`, and `eax`).

---

## 4. Dynamic Linking: GOT and PLT

Binaries often call library functions like `printf()` without containing the implementation code.

Linking every library statically creates large binary files and prevents shared memory pages across processes. Modern operating systems use **Dynamic Linking** with lazy binding through the Procedure Linkage Table (PLT) and Global Offset Table (GOT):

1. **PLT (Procedure Linkage Table):** A jump table in the executable. Calling `printf()` jumps to `printf@plt`.
2. **GOT (Global Offset Table):** An array of memory addresses located in the writable `.got.plt` section.
3. On the initial call, the GOT entry routes to resolver code in the dynamic linker (`ld.so`). The linker locates `printf` in `libc.so`, records the virtual memory address in the GOT, and executes the function.
4. On subsequent calls, `printf@plt` jumps directly to the recorded address in the GOT.

---

## 5. Security Mitigations in Modern Binaries

Binary analysis checks for specific hardening mechanisms:

1. **PIE (Position Independent Executable):** Enables ASLR. The operating system randomizes base memory addresses on each run to prevent fixed-address exploits.
2. **NX / DEP (No-Execute / Data Execution Prevention):** Enforces **W^X**. Memory pages can be writable or executable, but not both. Stack and heap pages cannot execute code.
3. **Stack Canaries:** Guard values placed on the stack frame before the return address. Overwriting the return pointer alters the canary. The runtime detects the change and terminates execution.

The `checksec` utility reports binary protections:

```bash
$ checksec --file=demo
RELRO           STACK CANARY      NX            PIE             RPATH      RUNPATH
Full RELRO      Canary found      NX enabled    PIE enabled     No RPATH   No RUNPATH
```

---

## Summary

Executable files are structured data formats. Headers instruct the kernel on memory layout. Sections organize code, constants, and variables. Symbol tables link external functions, and the dynamic linker resolves library pointers at launch.

These utilities provide visibility into compiled binary structures.
