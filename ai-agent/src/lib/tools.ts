/**
 * Jarbas AI Tools
 * All tools the AI agent can use to administer Orquestra.
 */

import { tool } from 'ai';
import { z } from 'zod';
import * as orq from './orquestra';
import { EVOLUTION_URL, EVOLUTION_API_KEY, EVOLUTION_INSTANCE } from './config';

// ─── Task Management ────────────────────────────────────────────────

export const listTasks = tool({
  description: 'Lista tasks do kanban. Pode filtrar por status (backlog, in_progress, review, done) ou por assignee.',
  parameters: z.object({
    status: z.enum(['backlog', 'in_progress', 'review', 'done']).optional()
      .describe('Filtrar por status'),
    assigned_to: z.string().optional()
      .describe('Filtrar por responsável (diego, claude)'),
  }),
  execute: async ({ status, assigned_to }) => {
    const tasks = await orq.listTasks({ status, assigned_to });
    return tasks.map((t: any) => ({
      id: t.id,
      title: t.title,
      status: t.status,
      priority: t.priority,
      project: t.project_name,
      assigned_to: t.assigned_to,
      created_at: t.created_at,
    }));
  },
});

export const createTask = tool({
  description: 'Cria uma nova task no kanban. Use para adicionar tarefas que Diego pede ou que você identifica como necessárias.',
  parameters: z.object({
    title: z.string().describe('Título da task (claro e acionável)'),
    description: z.string().optional().describe('Descrição detalhada'),
    priority: z.enum(['high', 'medium', 'low']).default('medium').describe('Prioridade'),
    project_name: z.string().optional().describe('Nome do projeto (ex: LicitaAI, Superbot, Orquestra)'),
    assigned_to: z.enum(['diego', 'claude']).default('diego').describe('Quem vai executar'),
  }),
  execute: async ({ title, description, priority, project_name, assigned_to }) => {
    // Find project ID by name
    let project_id: string | undefined;
    if (project_name) {
      const projects = await orq.listProjects();
      const match = projects.find((p: any) =>
        p.name.toLowerCase().includes(project_name.toLowerCase())
      );
      if (match) project_id = match.id;
    }

    const task = await orq.createTask({
      title,
      description,
      priority,
      project_id,
      assigned_to,
    });
    return { created: true, id: task.id, title: task.title, status: task.status };
  },
});

export const updateTask = tool({
  description: 'Atualiza uma task existente. Pode mudar status, prioridade, título, descrição ou responsável.',
  parameters: z.object({
    task_id: z.string().describe('ID da task (UUID)'),
    status: z.enum(['backlog', 'in_progress', 'review', 'done']).optional(),
    priority: z.enum(['high', 'medium', 'low']).optional(),
    title: z.string().optional(),
    description: z.string().optional(),
    assigned_to: z.string().optional(),
  }),
  execute: async ({ task_id, ...data }) => {
    const updated = await orq.updateTask(task_id, data);
    return { updated: true, id: updated.id, title: updated.title, status: updated.status };
  },
});

export const getTaskStats = tool({
  description: 'Retorna contagem de tasks por status (backlog, in_progress, review, done).',
  parameters: z.object({}),
  execute: async () => orq.getTaskStats(),
});

// ─── Contact Management ─────────────────────────────────────────────

export const searchContacts = tool({
  description: 'Busca contatos por nome, telefone ou empresa. Retorna dados completos incluindo pipeline, engagement e receita.',
  parameters: z.object({
    query: z.string().describe('Nome, telefone ou empresa para buscar'),
  }),
  execute: async ({ query }) => {
    const contacts = await orq.listContacts(query);
    return contacts.map((c: any) => ({
      id: c.id,
      name: c.name,
      phone: c.phone,
      company: c.company,
      pipeline_stage: c.pipeline_stage,
      engagement_score: c.engagement_score,
      monthly_revenue: c.monthly_revenue,
      next_action: c.next_action,
      last_message_at: c.last_message_at,
      message_count: c.message_count,
      notes: c.notes,
    }));
  },
});

export const updateContact = tool({
  description: 'Atualiza dados de um contato. Pode mudar pipeline, empresa, receita, engagement, notas, próxima ação.',
  parameters: z.object({
    contact_id: z.string().describe('ID do contato (UUID)'),
    name: z.string().optional(),
    company: z.string().optional(),
    pipeline_stage: z.enum(['lead', 'onboarding', 'building', 'delivered', 'maintenance', 'attention']).optional(),
    engagement_score: z.number().min(0).max(100).optional(),
    next_action: z.string().optional(),
    monthly_revenue: z.string().optional(),
    notes: z.string().optional(),
  }),
  execute: async ({ contact_id, ...data }) => {
    const updated = await orq.updateContact(contact_id, data);
    return { updated: true, name: updated.name, pipeline_stage: updated.pipeline_stage };
  },
});

// ─── WhatsApp Messages ──────────────────────────────────────────────

export const sendWhatsApp = tool({
  description: 'Envia uma mensagem WhatsApp para um contato. ATENÇÃO: Diego precisa aprovar antes de enviar para clientes. Para Diego mesmo, pode enviar direto.',
  parameters: z.object({
    phone: z.string().describe('Número do telefone com DDI (ex: 5551999998888)'),
    message: z.string().describe('Texto da mensagem (usar português correto com acentos)'),
  }),
  execute: async ({ phone, message }) => {
    // Send via Evolution API directly for reliability
    try {
      const res = await fetch(`${EVOLUTION_URL}/message/sendText/${EVOLUTION_INSTANCE}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': EVOLUTION_API_KEY,
        },
        body: JSON.stringify({ number: phone, text: message }),
      });
      const ok = res.ok;
      return { sent: ok, phone, preview: message.slice(0, 100) };
    } catch (e: any) {
      return { sent: false, error: e.message };
    }
  },
});

export const getConversation = tool({
  description: 'Busca as ÚLTIMAS 20 mensagens WhatsApp com um contato. Para resumo completo, use searchContacts (campo notes tem o digest diário). Use esta tool só para ver mensagens recentes.',
  parameters: z.object({
    contact_id: z.string().describe('ID do contato (UUID)'),
  }),
  execute: async ({ contact_id }) => {
    const messages = await orq.getConversation(contact_id);
    return messages.slice(-20).map((m: any) => ({
      direction: m.direction,
      content: (m.content || m.transcription || '').slice(0, 500) || `[${m.message_type}]`,
      timestamp: m.timestamp,
    }));
  },
});

// ─── Projects ───────────────────────────────────────────────────────

export const listProjects = tool({
  description: 'Lista todos os projetos registrados na Orquestra com suas informações.',
  parameters: z.object({}),
  execute: async () => {
    const projects = await orq.listProjects();
    return projects.map((p: any) => ({
      id: p.id,
      name: p.name,
      status: p.status,
      color: p.color,
    }));
  },
});

// ─── Proposals ──────────────────────────────────────────────────────

export const listProposals = tool({
  description: 'Lista propostas comerciais. Pode filtrar por status (draft, sent, viewed, accepted, rejected).',
  parameters: z.object({
    status: z.string().optional().describe('Filtrar por status'),
  }),
  execute: async ({ status }) => {
    const proposals = await orq.listProposals(status);
    return proposals.map((p: any) => ({
      id: p.id,
      title: p.title,
      client_name: p.client_name,
      status: p.status,
      total_value: p.total_value,
      viewed_at: p.viewed_at,
      created_at: p.created_at,
    }));
  },
});

// ─── Memory / RAG ───────────────────────────────────────────────────

export const searchMemory = tool({
  description: 'Busca semântica na memória da Orquestra. Encontra informações sobre clientes, projetos, decisões passadas.',
  parameters: z.object({
    query: z.string().describe('O que buscar na memória'),
    limit: z.number().default(5).describe('Quantidade de resultados'),
  }),
  execute: async ({ query, limit }) => {
    const results = await orq.searchMemory(query, limit);
    return results.map((r: any) => ({
      content: (r.content || '').slice(0, 300),
      summary: r.summary,
      source_type: r.source_type,
      similarity: r.similarity,
    }));
  },
});

export const saveMemory = tool({
  description: 'Salva uma informação importante na memória da Orquestra para consulta futura.',
  parameters: z.object({
    content: z.string().describe('Conteúdo para salvar'),
    summary: z.string().describe('Resumo curto'),
  }),
  execute: async ({ content, summary }) => {
    await orq.ingestMemory(content, 'jarbas_ai', summary);
    return { saved: true, summary };
  },
});

// ─── Proactive Analysis ─────────────────────────────────────────────

export const runProactiveAnalysis = tool({
  description: 'Executa a análise proativa completa: verifica tasks, propostas, contatos e envia relatório.',
  parameters: z.object({}),
  execute: async () => orq.triggerProactive(),
});

// ─── Recordings / Calls ─────────────────────────────────────────────

export const listRecordings = tool({
  description: 'Lista gravações de calls com transcrições. Use para entender acordos verbais, valores combinados, decisões.',
  parameters: z.object({}),
  execute: async () => {
    const recordings = await orq.listRecordings();
    return recordings.map((r: any) => ({
      id: r.id,
      title: r.title,
      project: r.project_name,
      duration_seconds: r.duration_seconds,
      summary: r.summary,
      action_items: r.action_items,
      transcription: (r.transcription || '').slice(0, 1000),
      created_at: r.created_at,
    }));
  },
});

// ─── Export all tools ───────────────────────────────────────────────

export const allTools = {
  listTasks,
  createTask,
  updateTask,
  getTaskStats,
  searchContacts,
  updateContact,
  sendWhatsApp,
  getConversation,
  listProjects,
  listProposals,
  searchMemory,
  saveMemory,
  listRecordings,
  runProactiveAnalysis,
};
