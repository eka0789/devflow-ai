/**
 * Zod schemas for every API request body. Used by the API for validation and
 * by the web client for form-level type inference.
 */
import { z } from 'zod';

// ---------- auth ----------

export const registerSchema = z.object({
  name: z.string().trim().min(2).max(80),
  email: z.string().trim().toLowerCase().email().max(200),
  password: z.string().min(8).max(200),
});
export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1),
});
export type LoginInput = z.infer<typeof loginSchema>;

// ---------- projects ----------

export const createProjectSchema = z.object({
  name: z.string().trim().min(2).max(120),
  description: z.string().max(4000).default(''),
  techStack: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
});
export type CreateProjectInput = z.infer<typeof createProjectSchema>;

export const updateProjectSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  description: z.string().max(4000).optional(),
  status: z.enum(['planning', 'active', 'paused', 'archived']).optional(),
  techStack: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
});
export type UpdateProjectInput = z.infer<typeof updateProjectSchema>;

// ---------- backlog ----------

export const createEpicSchema = z.object({
  title: z.string().trim().min(2).max(160),
  description: z.string().max(4000).default(''),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .default('#6E7BFF'),
});
export type CreateEpicInput = z.infer<typeof createEpicSchema>;

export const createStorySchema = z.object({
  epicId: z.string().uuid().nullable().optional(),
  title: z.string().trim().min(2).max(200),
  description: z.string().max(8000).default(''),
  points: z.number().int().min(0).max(100).default(3),
  priority: z.enum(['low', 'medium', 'high', 'critical']).default('medium'),
  acceptanceCriteria: z.array(z.string().min(1).max(500)).max(20).default([]),
});
export type CreateStoryInput = z.infer<typeof createStorySchema>;

export const updateStorySchema = z.object({
  epicId: z.string().uuid().nullable().optional(),
  sprintId: z.string().uuid().nullable().optional(),
  title: z.string().trim().min(2).max(200).optional(),
  description: z.string().max(8000).optional(),
  points: z.number().int().min(0).max(100).optional(),
  priority: z.enum(['low', 'medium', 'high', 'critical']).optional(),
  acceptanceCriteria: z.array(z.string().min(1).max(500)).max(20).optional(),
});
export type UpdateStoryInput = z.infer<typeof updateStorySchema>;

export const createTaskSchema = z.object({
  storyId: z.string().uuid(),
  title: z.string().trim().min(2).max(200),
  description: z.string().max(8000).default(''),
  priority: z.enum(['low', 'medium', 'high', 'critical']).default('medium'),
});
export type CreateTaskInput = z.infer<typeof createTaskSchema>;

export const updateTaskSchema = z.object({
  title: z.string().trim().min(2).max(200).optional(),
  description: z.string().max(8000).optional(),
  priority: z.enum(['low', 'medium', 'high', 'critical']).optional(),
  position: z.number().int().min(0).optional(),
});
export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;

export const transitionSchema = z.object({
  status: z.enum([
    'backlog',
    'todo',
    'in_progress',
    'in_review',
    'blocked',
    'done',
    'cancelled',
  ]),
});
export type TransitionInput = z.infer<typeof transitionSchema>;

export const createSubtaskSchema = z.object({
  title: z.string().trim().min(2).max(200),
});
export const addDependencySchema = z.object({
  dependsOnId: z.string().uuid(),
});

export const createCommentSchema = z.object({
  body: z.string().trim().min(1).max(4000),
});

// ---------- sprints ----------

export const createSprintSchema = z.object({
  name: z.string().trim().min(2).max(120),
  goal: z.string().max(2000).default(''),
  startsAt: z.string().datetime().nullable().optional(),
  endsAt: z.string().datetime().nullable().optional(),
});
export type CreateSprintInput = z.infer<typeof createSprintSchema>;

export const updateSprintSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  goal: z.string().max(2000).optional(),
  startsAt: z.string().datetime().nullable().optional(),
  endsAt: z.string().datetime().nullable().optional(),
});

// ---------- AI ----------

export const createConversationSchema = z.object({
  projectId: z.string().uuid().nullable().optional(),
  title: z.string().trim().max(200).optional(),
});

export const sendMessageSchema = z.object({
  content: z.string().trim().min(1).max(16000),
});

export const aiSettingsSchema = z.object({
  baseUrl: z.string().trim().url().max(300),
  apiKey: z.string().trim().min(1).max(400).nullable().optional(),
  model: z.string().trim().min(1).max(120),
});
export type AISettingsUpdateInput = z.infer<typeof aiSettingsSchema>;

export const runWorkflowSchema = z.object({
  workflow: z.enum([
    'full_planning',
    'prd_only',
    'tech_plan_only',
    'backlog_only',
    'sprint_review',
  ]),
  vision: z.string().trim().min(10).max(8000),
});

export const approveBacklogDraftSchema = z.object({
  createRecords: z.boolean().default(true),
});

// ---------- GitHub ----------

export const connectRepoSchema = z.object({
  repoFullName: z
    .string()
    .trim()
    .regex(/^[\w.-]+\/[\w.-]+$/, 'Expected owner/repo'),
});

export const githubTokenSchema = z.object({
  token: z.string().trim().min(20).max(200),
});

export const mergePRSchema = z.object({
  confirmation: z.literal('MERGE'),
  mergeMethod: z.enum(['merge', 'squash', 'rebase']).default('squash'),
});

// ---------- execution ----------

export const executeTaskSchema = z.object({
  createPR: z.boolean().default(true),
});

// ---------- AI backlog proposals (strict JSON contract for the Scrum Master agent) ----------

export const backlogProposalSchema = z.object({
  epics: z
    .array(
      z.object({
        title: z.string().min(2).max(160),
        description: z.string().max(2000).default(''),
        stories: z
          .array(
            z.object({
              title: z.string().min(2).max(200),
              description: z.string().max(4000).default(''),
              points: z.number().int().min(1).max(13),
              priority: z.enum(['low', 'medium', 'high', 'critical']),
              acceptanceCriteria: z.array(z.string().min(1).max(500)).max(10).default([]),
              dependencies: z.array(z.string().min(1).max(200)).max(20).default([]),
              tasks: z
                .array(
                  z.object({
                    title: z.string().min(2).max(200),
                    description: z.string().max(4000).default(''),
                    subtasks: z.array(z.string().min(1).max(200)).max(10).default([]),
                  })
                )
                .min(1)
                .max(8),
            })
          )
          .min(1)
          .max(10),
      })
    )
    .min(1)
    .max(6),
});

// ---------- pagination / misc ----------

export const idParamsSchema = z.object({
  id: z.string().uuid(),
});

export const projectScopedParamsSchema = z.object({
  projectId: z.string().uuid(),
});
