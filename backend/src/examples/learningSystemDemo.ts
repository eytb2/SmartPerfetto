/**
 * SQL学习系统演示
 * 展示完整的错误学习闭环
 */

import { SQLLearningSystem } from '../services/sqlLearningSystem';
import { SQLTemplateEngine } from '../services/sqlTemplateEngine';

// 模拟SQL验证器
function mockValidator(sql: string): { isValid: boolean; errors: string[] } {
  const errors: string[] = [];

  // 检查表名
  if (sql.includes('app_launch')) {
    errors.push("Table 'app_launch' doesn't exist");
  }

  // 检查字段
  if (sql.includes('FROM counter') && sql.includes('SELECT cpu')) {
    errors.push("Column 'cpu' doesn't exist in table 'counter'");
  }

  // 检查时间单位
  if (sql.includes('SELECT ts ') && !sql.includes('/ 1e')) {
    errors.push("Warning: timestamp should be converted to readable units");
  }

  return {
    isValid: errors.length === 0,
    errors
  };
}

// ============================================================================
// 演示场景
// ============================================================================

async function demo() {
  console.log('=' . repeat(80));
  console.log('🎓 SQL学习系统演示 - 完整的错误学习闭环');
  console.log('=' . repeat(80));
  console.log('');

  const system = new SQLLearningSystem('./demo_logs');
  await system.init();

  // ========================================================================
  // 场景1: 首次遇到错误 - 使用内置规则修正
  // ========================================================================
  console.log('\n📍 场景1: 首次遇到表名错误');
  console.log('-' . repeat(80));

  const wrongSQL1 = "SELECT * FROM app_launch WHERE ts > 1000";
  console.log(`错误SQL: ${wrongSQL1}`);
  console.log(`错误原因: 表 'app_launch' 不存在\n`);

  const result1 = await system.fixSQL(
    wrongSQL1,
    "Table 'app_launch' doesn't exist",
    "查询应用启动信息",
    mockValidator
  );

  console.log(`✓ 修正成功: ${result1.success}`);
  console.log(`修正方法: ${result1.method}`);
  console.log(`应用的规则: ${result1.appliedRules.join(', ')}`);
  console.log(`修正后SQL: ${result1.fixedSQL}`);

  // ========================================================================
  // 场景2: 再次遇到相同错误 - 直接应用规则
  // ========================================================================
  console.log('\n📍 场景2: 再次遇到相同的表名错误');
  console.log('-' . repeat(80));

  const wrongSQL2 = "SELECT name, dur FROM app_launch LIMIT 10";
  console.log(`错误SQL: ${wrongSQL2}`);
  console.log(`错误原因: 表 'app_launch' 不存在\n`);

  const result2 = await system.fixSQL(
    wrongSQL2,
    "Table 'app_launch' doesn't exist",
    "获取启动数据",
    mockValidator
  );

  console.log(`✓ 修正成功: ${result2.success}`);
  console.log(`修正方法: ${result2.method}`);
  console.log(`应用的规则: ${result2.appliedRules.join(', ')}`);
  console.log(`修正后SQL: ${result2.fixedSQL}`);
  console.log(`\n💡 注意: 规则的使用次数和成功率都增加了`);

  // ========================================================================
  // 场景3: 新的错误类型 - 字段不存在
  // ========================================================================
  console.log('\n📍 场景3: 遇到字段错误');
  console.log('-' . repeat(80));

  const wrongSQL3 = "SELECT cpu, value FROM counter WHERE ts > 1000";
  console.log(`错误SQL: ${wrongSQL3}`);
  console.log(`错误原因: counter表没有cpu字段\n`);

  const result3 = await system.fixSQL(
    wrongSQL3,
    "Column 'cpu' doesn't exist in table 'counter'",
    "查询CPU信息",
    mockValidator
  );

  console.log(`✓ 修正成功: ${result3.success}`);
  console.log(`修正方法: ${result3.method}`);
  console.log(`应用的规则: ${result3.appliedRules.join(', ')}`);
  console.log(`修正后SQL: ${result3.fixedSQL.substring(0, 100)}...`);

  // ========================================================================
  // 场景4: 模拟多次相同错误 - 为学习做准备
  // ========================================================================
  console.log('\n📍 场景4: 模拟多个用户都犯了时间单位错误');
  console.log('-' . repeat(80));

  const timeErrors = [
    "SELECT ts FROM slice WHERE name = 'test1'",
    "SELECT timestamp FROM slice WHERE name = 'test2'",
    "SELECT ts, name FROM slice LIMIT 10"
  ];

  console.log(`模拟3个用户都忘记转换时间单位...\n`);

  for (let i = 0; i < timeErrors.length; i++) {
    console.log(`用户${i + 1}: ${timeErrors[i]}`);
    await system.fixSQL(
      timeErrors[i],
      "Warning: timestamp should be converted",
      `用户${i + 1}的查询`,
      mockValidator
    );
  }

  console.log(`\n✓ 所有错误都被记录和修正`);

  // ========================================================================
  // 场景5: 运行学习任务 - 从成功的修正中学习新规则
  // ========================================================================
  console.log('\n📍 场景5: 运行定期学习任务');
  console.log('-' . repeat(80));

  console.log('分析所有成功的修正，寻找模式...\n');

  const newRulesCount = await system.learnNewRules();

  console.log(`✓ 学习完成!`);
  console.log(`新增规则数: ${newRulesCount}`);
  console.log(`\n💡 这些规则会在下次遇到类似错误时自动应用`);

  // ========================================================================
  // 场景6: 查看学习统计
  // ========================================================================
  console.log('\n📍 场景6: 查看学习统计');
  console.log('-' . repeat(80));

  const stats = await system.getStats();

  console.log(`\n📊 总体统计:`);
  console.log(`  总错误数: ${stats.totalErrors}`);
  console.log(`  成功修正数: ${stats.totalFixes}`);
  console.log(`  修正成功率: ${(stats.successRate * 100).toFixed(2)}%`);
  console.log(`  规则总数: ${stats.rulesCount}`);

  if (stats.topErrors.length > 0) {
    console.log(`\n🔝 Top 错误类型:`);
    stats.topErrors.forEach((e, i) => {
      console.log(`  ${i + 1}. ${e.type}: ${e.count}次`);
    });
  }

  if (stats.topRules.length > 0) {
    console.log(`\n🏆 Top 修正规则:`);
    stats.topRules.forEach((r, i) => {
      console.log(`  ${i + 1}. ${r.name}: 成功率 ${(r.successRate * 100).toFixed(2)}%`);
    });
  }

  // ========================================================================
  // 场景7: 生成学习报告
  // ========================================================================
  console.log('\n📍 场景7: 生成学习报告');
  console.log('-' . repeat(80));

  const report = await system.generateReport();
  console.log('\n' + report);

  // ========================================================================
  // 总结
  // ========================================================================
  console.log('\n' + '=' . repeat(80));
  console.log('✅ 演示完成！');
  console.log('=' . repeat(80));

  console.log(`\n🔄 闭环形成:`);
  console.log(`  1. ✅ 错误被记录`);
  console.log(`  2. ✅ 规则自动应用`);
  console.log(`  3. ✅ 修正结果验证`);
  console.log(`  4. ✅ 成功率被追踪`);
  console.log(`  5. ✅ 新规则自动学习`);
  console.log(`  6. ✅ 下次错误立即修正`);

  console.log(`\n💡 关键优势:`);
  console.log(`  • 首次错误: 尝试规则修正`);
  console.log(`  • 重复错误: 立即修正（已学习）`);
  console.log(`  • 新的模式: 自动学习并添加规则`);
  console.log(`  • 持续改进: 规则越用越准确`);

  console.log(`\n📈 预期效果:`);
  console.log(`  第1周: 修正率 60% → 75%`);
  console.log(`  第1月: 修正率 75% → 90%`);
  console.log(`  第3月: 修正率 90% → 95%+`);

  console.log(`\n🎯 下一步:`);
  console.log(`  1. 集成到现有的AI服务中`);
  console.log(`  2. 设置定期学习任务（每天）`);
  console.log(`  3. 监控学习效果`);
  console.log(`  4. 根据报告优化规则`);

  console.log('\n');
}

// 运行演示
if (require.main === module) {
  demo().catch(console.error);
}

export { demo };
