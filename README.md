# ncm2mp3 — 网易云 .ncm 本地离线解密转换工具

把网易云音乐下载的加密格式 `.ncm` 转换回普通的 `.mp3` / `.flac`，**全程在你本机完成，文件不上传任何服务器**。

## 🌐 在线使用（推荐 · 点开即用，无需下载）

👉 **https://merely-j.github.io/ncm2mp3/**

点开链接直接在浏览器里转换——把 `.ncm` 文件拖进页面即可，文件**只在你本机浏览器处理、不上传任何服务器**。无需下载、无需安装任何东西。

> 也支持直接访问工具页：https://merely-j.github.io/ncm2mp3/ncm2mp3_gui.html

---

也可以本地使用，提供三种方式：

1. **图形界面（离线）**：下载 `ncm2mp3_gui.html`，双击用浏览器打开，把 `.ncm` 拖进去即可批量转换并下载。
2. **单文件 exe（双击即用）**：`ncm2mp3.exe`，无需安装 Node、无需联网，命令行或拖文件都能用。
3. **命令行 / 源码**：`ncm2mp3.js`，需要 Node.js 环境。

> exe 以 GitHub Release 附件形式提供；源码与 GUI 在仓库主干。

---

## ⚠️ 使用前提与声明（请务必阅读）

本工具仅用于**处理你自己账号已合法下载的 `.ncm` 文件**，属于个人格式转换 / 本地备份用途：

- 请仅转换你自己购买或下载的内容；
- 解密出的音频**请勿对外分发、上传、传播**，尊重词曲作者与录音制作者的版权；
- 作者不对任何超出个人合理使用范围的用途负责；
- 不同版本网易云客户端生成的 `.ncm` 可能存在格式差异，如遇无法解密的文件，多半是加密方式已更新，欢迎提 Issue。

---

## 方式一：网页 / 图形界面（GUI）

**在线直接用（推荐）**：浏览器打开 https://merely-j.github.io/ncm2mp3/ ，无需下载任何文件。

**离线使用**：双击 `ncm2mp3_gui.html`（或拖进浏览器窗口）。

1. 把 `.ncm` 文件**拖入页面**，或点「选择文件」按钮（支持一次多选）。
2. 页面在**你本地浏览器**里实时解密，每首显示进度与「完成」。
3. 点每首后的「⬇ 下载」拿回 MP3（无损专辑会自动存成 FLAC）。
4. 支持「下载全部」「清空列表」。

> 纯前端实现（含自写的 AES-128-ECB 与定制 RC4），零依赖、零上传，发给别人也能直接用。

## 方式二：单文件 exe

从 Release 下载 `ncm2mp3.exe` 后：

```bat
:: 转单个文件（同目录输出 同名.mp3）
ncm2mp3.exe "歌.ncm"

:: 指定输出名
ncm2mp3.exe "歌.ncm" "输出.mp3"

:: 批量转换整个文件夹（默认跳过已存在，--force 覆盖）
ncm2mp3.exe --dir "文件夹路径" --out "输出目录"

:: 查看帮助
ncm2mp3.exe --help
```

也可以直接把 `.ncm` 拖到 `ncm2mp3.exe` 图标上，自动在同目录生成 mp3。

## 方式三：命令行 / 源码（需 Node.js）

```bash
# 安装 Node.js 后
node ncm2mp3.js "歌.ncm"            # 输出到同目录 同名.mp3
node ncm2mp3.js "歌.ncm" "输出.mp3" # 指定输出
node ncm2mp3.js --dir 文件夹 --out 输出目录   # 批量
node ncm2mp3.js --help
```

---

## 工作原理（简述）

`.ncm` 的逆向结构：

1. 文件头 `CTENFDAM` + 版本；
2. **密钥区**：每字节异或 `0x64` 后再用固定 `CORE_KEY` 做 AES-128-ECB 解密，去 PKCS7 填充后取 `[17:]` 得到音频的 RC4 密钥；
3. **metadata / 封面区**：按文件结构跳过（本工具不解析曲名，输出文件名沿用原文件名）；
4. **音频区**：起点需额外跳过 `imageSpace - imageSize` 的字节，再用非标准 RC4 密钥流（含 rotate 处理）逐字节异或还原；
5. 还原后按文件头判断为 `mp3`（ID3v2）还是 `flac`（fLaC）。

---

## 重新打包 exe（供开发者）

```bash
cd ncm2mp3
npm init -y
npm install postject --registry=https://registry.npmmirror.com
node --experimental-sea-config sea-config.json
cp "<你的 node.exe 路径>" ncm2mp3.exe
npx postject ncm2mp3.exe NODE_SEA_BLOB sea-prep.blob \
  --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2
```

---

## 许可证

[MIT](LICENSE) — 可自由使用、修改、分发，但请遵守上方使用声明。
