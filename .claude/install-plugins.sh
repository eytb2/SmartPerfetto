#!/bin/bash
# Claude Code Plugins 一键安装脚本
# 使用方法: cd /path/to/your/project && bash /path/to/install-plugins.sh

set -e

PLUGINS=(
    "superpowers@superpowers-marketplace"
    "wechat-article-writer@happy-claude-skills"
    "ralph-wiggum@claude-plugins-official"
    "frontend-design@claude-plugins-official"
    "feature-dev@claude-plugins-official"
    "claude-mem@thedotmack"
    "double-shot-latte@superpowers-marketplace"
    "elements-of-style@superpowers-marketplace"
    "superpowers-chrome@superpowers-marketplace"
    "superpowers-developing-for-claude-code@superpowers-marketplace"
    "superpowers-lab@superpowers-marketplace"
    "context7@claude-plugins-official"
    "video-processor@happy-claude-skills"
    "playwright@claude-plugins-official"
    "browser@happy-claude-skills"
    "claude-hud@claude-hud"
)

echo "🚀 开始安装 Claude Code 插件..."
echo "======================================"

for plugin in "${PLUGINS[@]}"; do
    echo ""
    echo "📦 正在安装: $plugin"
    if claude plugin install "$plugin" --scope project 2>&1 | grep -q "Successfully installed"; then
        echo "✅ $plugin 安装成功"
    else
        echo "⚠️ $plugin 安装可能失败，请检查"
    fi
done

echo ""
echo "======================================"
echo "🎉 所有插件安装完成！"
echo ""
echo "💡 提示："
echo "  - 插件已安装到当前项目的 Project 作用域"
echo "  - 配置文件保存在: .claude/settings.json"
echo "  - 将 .claude/settings.json 提交到 Git 即可与其他账号共享"
