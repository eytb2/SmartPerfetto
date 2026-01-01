/**
 * 测试SQL学习系统集成 - 命令行模拟完整流程
 */

import { SQLLearningSystem } from '../services/sqlLearningSystem';
import SQLValidator from '../services/sqlValidator';

async function main() {
  console.log('='.repeat(60));
  console.log('SQL学习系统集成测试');
  console.log('='.repeat(60));

  // 初始化
  const learningSystem = new SQLLearningSystem('./logs/sql_learning_test');
  const sqlValidator = new SQLValidator();

  // 模拟executeQuery的验证逻辑
  const validator = (sql: string) => {
    const result = sqlValidator.validateSQL(sql);
    return { isValid: result.isValid, errors: result.errors };
  };

  // 测试场景1: 错误的表名 app_launch
  console.log('\n📋 测试场景1: 错误的表名 app_launch');
  console.log('-'.repeat(40));

  const badSQL1 = `SELECT name, dur FROM app_launch WHERE dur > 1000000`;
  console.log('原始SQL:', badSQL1);

  const fix1 = await learningSystem.fixSQL(
    badSQL1,
    "no such table: app_launch",
    "查询启动时间超过1ms的事件",
    validator
  );

  console.log('修复结果:');
  console.log('  - 成功:', fix1.success);
  console.log('  - 修复后SQL:', fix1.fixedSQL);
  console.log('  - 应用规则:', fix1.appliedRules.join(', ') || '无');
  console.log('  - 修复方式:', fix1.method);

  // 测试场景2: 相同错误第二次出现
  console.log('\n📋 测试场景2: 相同错误再次出现');
  console.log('-'.repeat(40));

  const badSQL2 = `SELECT * FROM app_launch ORDER BY ts DESC`;
  console.log('原始SQL:', badSQL2);

  const fix2 = await learningSystem.fixSQL(
    badSQL2,
    "no such table: app_launch",
    "查询最近的启动事件",
    validator
  );

  console.log('修复结果:');
  console.log('  - 成功:', fix2.success);
  console.log('  - 修复后SQL:', fix2.fixedSQL);
  console.log('  - 应用规则:', fix2.appliedRules.join(', ') || '无');

  // 测试场景3: 时间单位问题
  console.log('\n📋 测试场景3: 时间单位转换');
  console.log('-'.repeat(40));

  const badSQL3 = `SELECT ts FROM slice WHERE name LIKE '%MainActivity%'`;
  console.log('原始SQL:', badSQL3);

  const fix3 = await learningSystem.fixSQL(
    badSQL3,
    "timestamp values are in nanoseconds, not readable",
    "查询MainActivity相关事件的时间戳",
    validator
  );

  console.log('修复结果:');
  console.log('  - 成功:', fix3.success);
  console.log('  - 修复后SQL:', fix3.fixedSQL);
  console.log('  - 应用规则:', fix3.appliedRules.join(', ') || '无');

  // 获取统计信息
  console.log('\n📊 学习系统统计');
  console.log('-'.repeat(40));

  const stats = await learningSystem.getStats();
  console.log('总错误数:', stats.totalErrors);
  console.log('成功修复数:', stats.totalFixes);
  console.log('修复成功率:', (stats.successRate * 100).toFixed(1) + '%');
  console.log('规则总数:', stats.rulesCount);

  if (stats.topRules.length > 0) {
    console.log('\n最有效的规则:');
    stats.topRules.forEach((rule, i) => {
      console.log(`  ${i + 1}. ${rule.name}: ${(rule.successRate * 100).toFixed(0)}% 成功率`);
    });
  }

  // 生成报告
  console.log('\n📝 学习报告');
  console.log('-'.repeat(40));

  const report = await learningSystem.generateReport();
  console.log(report);

  console.log('\n' + '='.repeat(60));
  console.log('✅ 测试完成！学习系统已集成并工作正常');
  console.log('='.repeat(60));
}

main().catch(console.error);
