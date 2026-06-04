import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express from "express";
import { z } from "zod";

const YOUGILE_KEY = process.env.YOUGILE_KEY || "";
const BASE = "https://ru.yougile.com/api-v2";
const BASE_V1 = "https://yougile.com/data/api-v1";

// --- API helpers ---

async function api(method: string, path: string, body?: unknown): Promise<unknown> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${YOUGILE_KEY}`
    },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  return res.json();
}

async function apiv1(method: string, path: string, body?: unknown): Promise<unknown> {
  const res = await fetch(`${BASE_V1}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      "Authorization": `YOUGILE-KEY ${YOUGILE_KEY}`
    },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  return res.json();
}

function text(data: unknown): { content: Array<{ type: "text"; text: string }> } {
  return { content: [{ type: "text", text: typeof data === "string" ? data : JSON.stringify(data, null, 2) }] };
}

// Форматирование дедлайна — может прийти строка или объект {timestamp}
function formatDeadline(deadline: unknown): string {
  if (!deadline) return "";
  if (typeof deadline === "string") return deadline;
  if (typeof deadline === "object" && deadline !== null && "timestamp" in deadline) {
    const ts = (deadline as { timestamp: number }).timestamp;
    return new Date(ts).toISOString().split("T")[0];
  }
  return "";
}

// Форматирование даты из timestamp
function formatDate(ts: number | undefined): string {
  if (!ts) return "";
  return new Date(ts).toISOString().split("T")[0];
}

// --- MCP Server ---

const server = new McpServer({ name: "yougile-mcp-server", version: "2.0.0" });

// Получить список проектов
server.registerTool(
  "yougile_list_projects",
  {
    title: "Список проектов",
    description: "Получить список всех проектов в YouGile. Возвращает id и название каждого проекта.",
    inputSchema: z.object({}).strict(),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  },
  async () => {
    const data = await api("GET", "/projects?limit=100") as { content?: Array<{ id: string; title: string }> };
    const projects = data.content || [];
    if (!projects.length) return text("Проекты не найдены");
    const list = projects.map(p => `• ${p.title} [id: ${p.id}]`).join("\n");
    return text(`Проекты (${projects.length}):\n${list}`);
  }
);

// Получить доски проекта
server.registerTool(
  "yougile_list_boards",
  {
    title: "Доски проекта",
    description: "Получить список досок внутри проекта YouGile. Нужен projectId из yougile_list_projects.",
    inputSchema: z.object({
      projectId: z.string().describe("ID проекта из yougile_list_projects")
    }).strict(),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  },
  async ({ projectId }) => {
    const data = await api("GET", `/boards?projectId=${projectId}&limit=100`) as { content?: Array<{ id: string; title: string }> };
    const boards = data.content || [];
    if (!boards.length) return text("Доски не найдены");
    const list = boards.map(b => `• ${b.title} [id: ${b.id}]`).join("\n");
    return text(`Доски (${boards.length}):\n${list}`);
  }
);

// Получить колонки доски
server.registerTool(
  "yougile_list_columns",
  {
    title: "Колонки доски",
    description: "Получить список колонок на доске YouGile. Нужен boardId из yougile_list_boards.",
    inputSchema: z.object({
      boardId: z.string().describe("ID доски из yougile_list_boards")
    }).strict(),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  },
  async ({ boardId }) => {
    const data = await api("GET", `/columns?boardId=${boardId}&limit=100`) as { content?: Array<{ id: string; title: string }> };
    const columns = data.content || [];
    if (!columns.length) return text("Колонки не найдены");
    const list = columns.map(c => `• ${c.title} [id: ${c.id}]`).join("\n");
    return text(`Колонки (${columns.length}):\n${list}`);
  }
);

// Получить задачи из колонки
server.registerTool(
  "yougile_list_tasks",
  {
    title: "Задачи в колонке",
    description: "Получить список задач из конкретной колонки YouGile с датой создания, дедлайном и исполнителем.",
    inputSchema: z.object({
      columnId: z.string().describe("ID колонки из yougile_list_columns")
    }).strict(),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  },
  async ({ columnId }) => {
    const data = await api("GET", `/tasks?columnId=${columnId}&limit=100`) as {
      content?: Array<{
        id: string;
        title: string;
        deadline?: unknown;
        timestamp?: number;
        assigned?: string[];
        createdBy?: string;
      }>
    };
    const tasks = data.content || [];
    if (!tasks.length) return text("Задачи не найдены");
    const list = tasks.map(t => {
      let row = `• ${t.title} [id: ${t.id}]`;
      if (t.timestamp) row += ` | создана: ${formatDate(t.timestamp)}`;
      const dl = formatDeadline(t.deadline);
      if (dl) row += ` | дедлайн: ${dl}`;
      if (t.assigned?.length) row += ` | исполнители: ${t.assigned.join(", ")}`;
      return row;
    }).join("\n");
    return text(`Задачи (${tasks.length}):\n${list}`);
  }
);

// Создать задачу
server.registerTool(
  "yougile_create_task",
  {
    title: "Создать задачу",
    description: `Создать новую задачу в колонке YouGile через v2 API.
Требует columnId (из yougile_list_columns) и title.
Приоритет через stickers: Важно | Нормально | Не важно.
Дедлайн в формате YYYY-MM-DD.`,
    inputSchema: z.object({
      columnId: z.string().describe("ID колонки куда добавить задачу"),
      title: z.string().min(1).max(255).describe("Название задачи"),
      description: z.string().optional().describe("Описание задачи"),
      priority: z.enum(["Важно", "Нормально", "Не важно"]).optional().describe("Приоритет задачи"),
      deadline: z.string().optional().describe("Дедлайн в формате YYYY-MM-DD"),
      assignee: z.string().optional().describe("ID пользователя (из yougile_list_users)")
    }).strict(),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }
  },
  async ({ columnId, title, description, priority, deadline, assignee }) => {
    // v2 API для создания задачи
    const body: Record<string, unknown> = {
      title,
      columnId,
      stickers: priority ? { "Приоритет": { name: priority } } : undefined
    };
    if (description) body.description = description;
    if (deadline) body.deadline = { deadline, time: false };
    if (assignee) body.assigned = { [assignee]: true };

    const data = await api("POST", "/tasks", body) as { id?: string; error?: string; message?: string };

    if (data.id) {
      return text(`✓ Задача создана!\nНазвание: ${title}\nID: ${data.id}`);
    }

    // Fallback на v1 если v2 не сработал
    const bodyV1: Record<string, unknown> = {
      title,
      location: columnId,
      stringStickers: { "Приоритет": priority || "Нормально" }
    };
    if (description) bodyV1.description = description;
    if (deadline) bodyV1.deadline = deadline;
    if (assignee) bodyV1.assigned = assignee;

    const dataV1 = await apiv1("POST", "/tasks", bodyV1) as { result: string; id?: string; error?: string };
    if (dataV1.result === "ok") {
      return text(`✓ Задача создана!\nНазвание: ${title}\nID: ${dataV1.id}`);
    }
    return text(`Ошибка: ${data.error || data.message || dataV1.error || JSON.stringify(data)}`);
  }
);

// Обновить задачу
server.registerTool(
  "yougile_update_task",
  {
    title: "Обновить задачу",
    description: "Обновить существующую задачу в YouGile. Можно менять название, описание, приоритет, дедлайн, колонку.",
    inputSchema: z.object({
      taskId: z.string().describe("ID задачи которую нужно обновить"),
      title: z.string().optional().describe("Новое название"),
      description: z.string().optional().describe("Новое описание"),
      priority: z.enum(["Важно", "Нормально", "Не важно"]).optional().describe("Новый приоритет"),
      deadline: z.string().optional().describe("Новый дедлайн YYYY-MM-DD"),
      columnId: z.string().optional().describe("Переместить в другую колонку")
    }).strict(),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  },
  async ({ taskId, title, description, priority, deadline, columnId }) => {
    const body: Record<string, unknown> = { id: taskId };
    if (title) body.title = title;
    if (description) body.description = description;
    if (priority) body.stringStickers = { "Приоритет": priority };
    if (deadline) body.deadline = deadline;
    if (columnId) body.location = columnId;

    const data = await apiv1("PUT", "/tasks", body) as { result: string; id?: string; error?: string };
    if (data.result === "ok") return text(`✓ Задача ${taskId} обновлена`);
    return text(`Ошибка: ${data.error || JSON.stringify(data)}`);
  }
);

// Получить пользователей
server.registerTool(
  "yougile_list_users",
  {
    title: "Список пользователей",
    description: "Получить список всех сотрудников компании в YouGile с их ID для назначения на задачи.",
    inputSchema: z.object({}).strict(),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  },
  async () => {
    const data = await api("GET", "/users?limit=100") as {
      content?: Array<{ id: string; name?: string; username?: string; email: string; isAdmin?: boolean }>
    };
    const users = data.content || [];
    if (!users.length) return text("Пользователи не найдены");
    const list = users.map(u => {
      const name = u.name || u.username || "—";
      return `• ${name} (${u.email})${u.isAdmin ? " [admin]" : ""} [id: ${u.id}]`;
    }).join("\n");
    return text(`Сотрудники (${users.length}):\n${list}`);
  }
);

// Отправить сообщение в чат задачи
server.registerTool(
  "yougile_send_message",
  {
    title: "Сообщение в задачу",
    description: "Отправить сообщение в чат задачи YouGile.",
    inputSchema: z.object({
      taskId: z.string().describe("ID задачи"),
      text: z.string().min(1).describe("Текст сообщения")
    }).strict(),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }
  },
  async ({ taskId, text: msgText }) => {
    // Сначала пробуем v2
    const dataV2 = await api("POST", `/tasks/${taskId}/chat`, { text: msgText }) as { id?: string; error?: string };
    if (dataV2.id) return text(`✓ Сообщение отправлено`);

    // Fallback на v1
    const dataV1 = await apiv1("POST", "/messages", { taskId, text: msgText }) as { result: string; error?: string };
    if (dataV1.result === "ok") return text(`✓ Сообщение отправлено`);
    return text(`Ошибка: ${dataV1.error || JSON.stringify(dataV1)}`);
  }
);

// --- HTTP Transport ---

async function main(): Promise<void> {
  const app = express();
  app.use(express.json());

  app.get("/", (_req, res) => {
    res.json({ status: "ok", service: "YouGile MCP Server", version: "2.0.0" });
  });

  app.post("/mcp", async (req, res) => {
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true
    });
    res.on("close", () => transport.close());
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });

  const PORT = parseInt(process.env.PORT || "3000");
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`YouGile MCP сервер v2.0 запущен на порту ${PORT}`);
  });
}

main().catch(err => {
  console.error("Ошибка запуска:", err);
  process.exit(1);
});
