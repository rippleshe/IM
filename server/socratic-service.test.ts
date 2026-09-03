import { describe, expect, it, beforeEach, vi } from 'vitest';
import {
  startSocraticSession,
  selectSocraticTargetFromPath,
  type SocraticSession,
} from './socratic-service.js';

describe('苏格拉底式引导对话服务', () => {
  describe('selectSocraticTargetFromPath', () => {
    it('从学习路径中选择最需要追问的知识点（高关键度 × 低掌握度）', () => {
      const pathNodes = [
        {
          id: 'node-1',
          knowledgePointId: 'kp-101',
          title: '轴承故障基础',
          recommendation: 'critical',
          bktParams: { pMastery: 0.3, confidence: 0.4 },
          userStatus: 'in-progress',
        },
        {
          id: 'node-2',
          knowledgePointId: 'kp-102',
          title: '频谱分析入门',
          recommendation: 'important',
          bktParams: { pMastery: 0.7, confidence: 0.8 },
          userStatus: 'in-progress',
        },
        {
          id: 'node-3',
          knowledgePointId: 'kp-103',
          title: '轴承类型识别',
          recommendation: 'optional',
          bktParams: { pMastery: 0.5, confidence: 0.6 },
          userStatus: 'completed',
        },
      ];

      const target = selectSocraticTargetFromPath(pathNodes);

      expect(target).not.toBeNull();
      expect(target?.knowledgePointId).toBe('kp-101');
      expect(target?.label).toBe('轴承故障基础');
      expect(target?.confidence).toBe(0.4);
    });

    it('跳过已完成的节点', () => {
      const pathNodes = [
        {
          id: 'node-1',
          knowledgePointId: 'kp-101',
          title: '已完成知识点',
          recommendation: 'critical',
          bktParams: { pMastery: 0.9, confidence: 0.95 },
          userStatus: 'completed',
        },
      ];

      const target = selectSocraticTargetFromPath(pathNodes);

      expect(target).toBeNull();
    });

    it('在无候选节点时返回 null', () => {
      const target = selectSocraticTargetFromPath([]);
      expect(target).toBeNull();
    });
  });

  describe('startSocraticSession', () => {
    it('创建新的苏格拉底对话会话', () => {
      const session = startSocraticSession(
        'learner-123',
        'kp-101',
        '轴承故障基础',
        0.4
      );

      expect(session).toMatchObject({
        learnerId: 'learner-123',
        targetKnowledgePointId: 'kp-101',
        targetLabel: '轴承故障基础',
        round: 0,
        confidence: 0.4,
        history: [],
      });
      expect(session.id).toBeTruthy();
      expect(session.createdAt).toBeGreaterThan(0);
      expect(session.updatedAt).toBeGreaterThan(0);
    });

    it('生成唯一的会话 ID', () => {
      const session1 = startSocraticSession('learner-1', 'kp-1', 'KP1', 0.5);
      const session2 = startSocraticSession('learner-1', 'kp-1', 'KP1', 0.5);

      expect(session1.id).not.toBe(session2.id);
    });
  });
});
