import { TaskComplexityHint } from './config.js';
import { ModelRouter } from './router.js';
import type { ModelRegistry } from './registry.js';

export interface ComplexityRule {
  patterns: RegExp[];
  hint: TaskComplexityHint;
}

const DEFAULT_RULES: ComplexityRule[] = [
  {
    patterns: [/研究|调研|deep.?research|market.?research/i],
    hint: { complexity: 'heavy', requiredSpecialties: ['analysis', 'writing'], requiresTools: true, requiresStreaming: true },
  },
  {
    patterns: [/代码|编程|coding|implement|debug/i],
    hint: { complexity: 'medium', requiredSpecialties: ['coding', 'reasoning'], requiresTools: true },
  },
  {
    patterns: [/评估|evaluat|审核|review|judge/i],
    hint: { complexity: 'heavy', requiredSpecialties: ['reasoning', 'analysis'], requiresStreaming: true },
  },
  {
    patterns: [/规划|plan|replan/i],
    hint: { complexity: 'medium', requiredSpecialties: ['planning', 'reasoning'], requiresStreaming: false },
  },
  {
    patterns: [/协作|coordinat|supervis|orchestrat/i],
    hint: { complexity: 'heavy', requiredSpecialties: ['planning'], requiresTools: true, requiresStreaming: false },
  },
  {
    patterns: [/简单|greet|hello|chat|闲聊/i],
    hint: { complexity: 'light', requiredSpecialties: ['chat'], requiresStreaming: false },
  },
];

export class ComplexityEstimator {
  private rules: ComplexityRule[];

  constructor(rules?: ComplexityRule[]) {
    this.rules = rules ?? DEFAULT_RULES;
  }

  /**
   * Estimate task complexity from a description string.
   * Falls back to the router's heuristic when no rule matches.
   */
  estimate(description: string, _router?: ModelRouter): TaskComplexityHint {
    const lower = description.toLowerCase();

    for (const rule of this.rules) {
      if (rule.patterns.some((p) => p.test(lower))) {
        return rule.hint;
      }
    }

    return { complexity: 'medium', requiresTools: false };
  }

  /**
   * Map priority level to a complexity hint for model selection.
   */
  priorityToHint(priority: string): TaskComplexityHint {
    switch (priority) {
      case 'critical':
        return { complexity: 'heavy', requiresTools: true, requiresStreaming: true };
      case 'high':
        return { complexity: 'heavy', requiresTools: false, requiresStreaming: false };
      case 'normal':
        return { complexity: 'medium', requiresTools: true };
      case 'low':
        return { complexity: 'light', requiresTools: false };
      default:
        return { complexity: 'medium', requiresTools: false };
    }
  }

  /**
   * Select the best model for a subTask given its properties.
   */
  selectModelForSubTask(
    _registry: ModelRegistry,
    router: ModelRouter,
    subTask: {
      priority?: string;
      tools?: string[];
      assignedAgentType?: string;
    }
  ): { modelId: string; providerId: string; hint: TaskComplexityHint } {
    const hasTools = (subTask.tools?.length ?? 0) > 0;
    let hint: TaskComplexityHint;

    if (subTask.priority) {
      hint = this.priorityToHint(subTask.priority);
      if (hasTools && !hint.requiresTools) {
        hint.requiresTools = true;
      }
    } else if (hasTools) {
      hint = { complexity: 'medium', requiresTools: true };
    } else {
      hint = { complexity: 'light', requiresTools: false };
    }

    if (subTask.assignedAgentType) {
      const specialtyMap: Record<string, string[]> = {
        researcher: ['analysis'],
        analyst: ['analysis', 'reasoning'],
        writer: ['writing'],
        critic: ['reasoning'],
        coder: ['coding', 'reasoning'],
        strategist: ['reasoning', 'planning'],
      };
      const specialties = specialtyMap[subTask.assignedAgentType];
      if (specialties) {
        hint.requiredSpecialties = [...(hint.requiredSpecialties ?? []), ...specialties] as TaskComplexityHint['requiredSpecialties'];
      }
    }

    const result = router.select('complexity', {
      complexityHint: hint,
      allowLightModel: true,
    });

    return {
      modelId: result.model.id,
      providerId: result.providerId,
      hint,
    };
  }
}
