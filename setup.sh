#!/bin/bash

echo "========================================"
echo " Windsurf 注册助手 - 自动配置脚本"
echo "========================================"
echo ""

echo "[1/2] 复制配置文件..."
if [ ! -f "extension/email-config.js" ]; then
    cp "extension/email-config.example.js" "extension/email-config.js"
    echo "✓ 已创建 email-config.js"
else
    echo "! email-config.js 已存在，跳过"
fi

if [ ! -f "extension/config.js" ]; then
    cp "extension/config.example.js" "extension/config.js"
    echo "✓ 已创建 config.js"
else
    echo "! config.js 已存在，跳过"
fi

echo ""
echo "[2/2] 配置完成！"
echo ""
echo "========================================"
echo " 接下来的步骤："
echo "========================================"
echo "1. 打开 Chrome/Edge 浏览器"
echo "2. 访问 chrome://extensions/ 或 edge://extensions/"
echo "3. 开启"开发者模式""
echo "4. 点击"加载已解压的扩展程序""
echo "5. 选择 extension 文件夹"
echo ""
echo "按任意键退出..."
read -n 1 -s
