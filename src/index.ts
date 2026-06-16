import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express from "express";
import { z } from "zod";
const YOUGILE_KEY = process.env.YOUGILE_KEY || "";
const BASE = "https://ru.yougile.com/api-v2";

// --- API helpers ---

async function api(method: string, path: string, body?: unknown): Promise<unknown> {
  let bodyStr: string | undefined;
  if (body) {
    bodyStr = JSON.stringify(body);
    bodyStr = bodyStr.replace(/\\n/g, "\n");
  }
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${YOUGILE_KEY}`
    },
    ...(bodyStr ? { body: bodyStr } : {})
  });
  return res.json();
}

// Загрузка файла из base64 (multipart/form-data)
async function uploadFileBase64(
  base64: string,
  fileName: string,
  mimeType: string
): Promise<{ url: string; fullUrl: string } | null> {
  try {
    const buffer = Buffer.from(base64, "base64");
    const form = new FormData();
    form.append("file", new Blob([buffer], { type: mimeType }), fileName);

    const res = await fetch(`${BASE}/upload-file`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${YOUGILE_KEY}` },
      body: form
    });
    const data = await res.json() as { url?: string; fullUrl?: string };
    if (data.fullUrl) return { url: data.url!, fullUrl: data.fullUrl };
    return null;
  } catch {
    return null;
  }
}

function text(data: unknown): { content: Array<{ type: "text"; text: string }> } {
  return { content: [{ type: "text", text: typeof data === "string" ? data : JSON.stringify(data, null, 2) }] };
}

function formatDate(ts: number | undefined): string {
  if (!ts) return "";
  return new Date(ts).toISOString().split("T")[0];
}

function dateToTimestamp(dateStr: string): number {
  return new Date(dateStr + "T12:00:00.000Z").getTime();
}

// Оборачивает URL в кликабельные ссылки
function linkify(text: string): string {
  return text.replace(/(https?:\/\/[^\s]+)/g, '<a href="$1">$1</a>');
}

// Конвертация текста с \n в HTML для поля description
function toHtml(txt: string): string {
  return txt.split("\n").map(line => {
    const linked = linkify(line);
    if (/^\d+\.\s/.test(line)) return `<p style="margin:0 0 4px 16px">${linked}</p>`;
    if (line.trim() === "") return `<p style="margin:8px 0"></p>`;
    return `<p style="margin:0 0 4px">${linked}</p>`;
  }).join("");
}

// --- MCP Server ---

const server = new McpServer({ name: "yougile-mcp-server", version: "4.6.0" });

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
    description: "Получить список задач из конкретной колонки YouGile с датой создания, дедлайном, исполнителем и стикерами.",
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
        deadline?: { deadline?: number };
        timestamp?: number;
        assigned?: string[];
        stickers?: Record<string, string>;
      }>
    };
    const tasks = data.content || [];
    if (!tasks.length) return text("Задачи не найдены");
    const list = tasks.map(t => {
      let row = `• ${t.title} [id: ${t.id}]`;
      if (t.timestamp) row += ` | создана: ${formatDate(t.timestamp)}`;
      if (t.deadline?.deadline) row += ` | дедлайн: ${formatDate(t.deadline.deadline)}`;
      if (t.assigned?.length) row += ` | исполнители: ${t.assigned.join(", ")}`;
      if (t.stickers && Object.keys(t.stickers).length) {
        const stickerStr = Object.entries(t.stickers).map(([k, v]) => `${k}:${v}`).join(", ");
        row += ` | стикеры: ${stickerStr}`;
      }
      return row;
    }).join("\n");
    return text(`Задачи (${tasks.length}):\n${list}`);
  }
);


// Получить детали одной задачи по ID
server.registerTool(
  "yougile_get_task",
  {
    title: "Детали задачи",
    description: "Получить полную информацию по задаче YouGile: название, описание (plain text), приоритет, дедлайн, исполнителей, стикеры. Нужен taskId из yougile_list_tasks.",
    inputSchema: z.object({
      taskId: z.string().describe("ID задачи из yougile_list_tasks")
    }).strict(),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  },
  async ({ taskId }) => {
    const data = await api("GET", `/tasks/${taskId}`) as {
      id?: string;
      title?: string;
      description?: string;
      color?: string;
      deadline?: { deadline?: number };
      timestamp?: number;
      assigned?: string[];
      stickers?: Record<string, string>;
      completed?: boolean;
      error?: string;
      message?: string;
    };

    if (!data.id) {
      return text(`Ошибка: ${data.error || data.message || "Задача не найдена"}`);
    }

    function htmlToPlain(html: string): string {
      return html
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<\/p>/gi, "\n")
        .replace(/<p[^>]*>/gi, "")
        .replace(/<li[^>]*>/gi, "- ")
        .replace(/<\/li>/gi, "\n")
        .replace(/<[^>]+>/g, "")
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/\n{3,}/g, "\n\n")
        .trim();
    }

    const colorMap: Record<string, string> = {
      "task-red": "Важно",
      "task-yellow": "Нормально",
      "task-blue": "Не важно"
    };

    const lines: string[] = [];
    lines.push(`Задача: ${data.title}`);
    lines.push(`ID: ${data.id}`);
    if (data.timestamp) lines.push(`Создана: ${formatDate(data.timestamp)}`);
    if (data.deadline?.deadline) lines.push(`Дедлайн: ${formatDate(data.deadline.deadline)}`);
    if (data.color) lines.push(`Приоритет: ${colorMap[data.color] || data.color}`);
    if (data.completed !== undefined) lines.push(`Завершена: ${data.completed ? "да" : "нет"}`);
    if (data.assigned?.length) lines.push(`Исполнители: ${data.assigned.join(", ")}`);
    if (data.stickers && Object.keys(data.stickers).length) {
      const stickerStr = Object.entries(data.stickers).map(([k, v]) => `${k}:${v}`).join(", ");
      lines.push(`Стикеры: ${stickerStr}`);
    }
    lines.push("");
    if (data.description) {
      lines.push("ОПИСАНИЕ:");
      lines.push(htmlToPlain(data.description));
    } else {
      lines.push("ОПИСАНИЕ: (пусто)");
    }

    return text(lines.join("\n"));
  }
);

// Получить стикеры компании (кастомные и спринтовые)
server.registerTool(
  "yougile_list_stickers",
  {
    title: "Список стикеров",
    description: "Получить все кастомные (string) и спринтовые стикеры компании. Возвращает ID стикеров и их состояний — нужны для yougile_set_sticker и yougile_set_sprint.",
    inputSchema: z.object({}).strict(),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  },
  async () => {
    const [stringData, sprintData] = await Promise.all([
      api("GET", "/string-stickers?limit=100") as Promise<{
        content?: Array<{ id: string; name: string; states?: Array<{ id: string; name: string; color?: string }> }>
      }>,
      api("GET", "/sprint-stickers?limit=100") as Promise<{
        content?: Array<{ id: string; name: string; states?: Array<{ id: string; name: string; begin?: number; end?: number }> }>
      }>
    ]);

    const lines: string[] = [];

    const stringStickers = (stringData as { content?: Array<{ id: string; name: string; states?: Array<{ id: string; name: string; color?: string }> }> }).content || [];
    if (stringStickers.length) {
      lines.push("Кастомные стикеры (string-stickers):");
      for (const s of stringStickers) {
        lines.push(`  • ${s.name} [stickerId: ${s.id}]`);
        if (s.states?.length) {
          for (const st of s.states) {
            lines.push(`      - ${st.name} [stateId: ${st.id}]${st.color ? ` (${st.color})` : ""}`);
          }
        }
      }
    }

    const sprintStickers = (sprintData as { content?: Array<{ id: string; name: string; states?: Array<{ id: string; name: string; begin?: number; end?: number }> }> }).content || [];
    if (sprintStickers.length) {
      if (lines.length) lines.push("");
      lines.push("Спринтовые стикеры:");
      for (const s of sprintStickers) {
        lines.push(`  • ${s.name} [stickerId: ${s.id}]`);
        if (s.states?.length) {
          for (const st of s.states) {
            let sprintLine = `      - ${st.name} [stateId: ${st.id}]`;
            if (st.begin) sprintLine += ` | начало: ${formatDate(st.begin * 1000)}`;
            if (st.end) sprintLine += ` | конец: ${formatDate(st.end * 1000)}`;
            lines.push(sprintLine);
          }
        }
      }
    }

    if (!lines.length) return text("Стикеры не найдены");
    return text(lines.join("\n"));
  }
);

// Установить значение кастомного стикера на задаче
server.registerTool(
  "yougile_set_sticker",
  {
    title: "Установить стикер на задаче",
    description: "Установить значение кастомного string-стикера на задаче (например: Приоритет = Высокий). ID стикера и состояния берутся из yougile_list_stickers.",
    inputSchema: z.object({
      taskId: z.string().describe("ID задачи"),
      stickerId: z.string().describe("ID стикера из yougile_list_stickers"),
      stateId: z.string().describe("ID состояния стикера из yougile_list_stickers")
    }).strict(),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  },
  async ({ taskId, stickerId, stateId }) => {
    // Стикеры передаются через PUT /tasks/{id} в поле stickers: { stickerId: stateId }
    const data = await api("PUT", `/tasks/${taskId}`, {
      stickers: { [stickerId]: stateId }
    }) as { id?: string; error?: string; message?: string };

    if (data.id) {
      return text(`✓ Стикер установлен на задаче ${taskId}`);
    }
    return text(`Ошибка: ${data.error || data.message || JSON.stringify(data)}`);
  }
);

// Назначить задачу на спринт
server.registerTool(
  "yougile_set_sprint",
  {
    title: "Назначить задачу на спринт",
    description: "Назначить задачу на спринт. ID спринтового стикера и состояния (спринта) берутся из yougile_list_stickers.",
    inputSchema: z.object({
      taskId: z.string().describe("ID задачи"),
      sprintStickerId: z.string().describe("ID спринтового стикера из yougile_list_stickers"),
      sprintStateId: z.string().describe("ID конкретного спринта (состояния) из yougile_list_stickers")
    }).strict(),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  },
  async ({ taskId, sprintStickerId, sprintStateId }) => {
    // Спринтовые стикеры тоже передаются через PUT /tasks/{id} в поле stickers
    const data = await api("PUT", `/tasks/${taskId}`, {
      stickers: { [sprintStickerId]: sprintStateId }
    }) as { id?: string; error?: string; message?: string };

    if (data.id) {
      return text(`✓ Задача ${taskId} назначена на спринт`);
    }
    return text(`Ошибка: ${data.error || data.message || JSON.stringify(data)}`);
  }
);

// Создать задачу
server.registerTool(
  "yougile_create_task",
  {
    title: "Создать задачу",
    description: `Создать новую задачу в колонке YouGile через v2 API.
Требует columnId (из yougile_list_columns) и title.
Приоритет: Важно | Нормально | Не важно.
Дедлайн в формате YYYY-MM-DD.
Исполнитель: ID пользователя из yougile_list_users.`,
    inputSchema: z.object({
      columnId: z.string().describe("ID колонки куда добавить задачу"),
      title: z.string().min(1).max(255).describe("Название задачи"),
      description: z.string().optional().describe("Описание задачи"),
      priority: z.enum(["Важно", "Нормально", "Не важно"]).optional().describe("Приоритет задачи"),
      deadline: z.string().optional().describe("Дедлайн в формате YYYY-MM-DD"),
      assignee: z.string().optional().describe("ID пользователя (из yougile_list_users)"),
      assignees: z.array(z.string()).optional().describe("Массив ID пользователей для назначения нескольких исполнителей")
    }).strict(),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }
  },
  async ({ columnId, title, description, priority, deadline, assignee, assignees }) => {
    const assignedIds: string[] = [];
    if (assignees?.length) assignedIds.push(...assignees);
    else if (assignee) assignedIds.push(assignee);

    const body: Record<string, unknown> = { title, columnId };

    if (description) body.description = toHtml(description);
    if (assignedIds.length) body.assigned = assignedIds;
    if (deadline) body.deadline = { deadline: dateToTimestamp(deadline) };

    if (priority) {
      const colorMap: Record<string, string> = {
        "Важно": "task-red",
        "Нормально": "task-yellow",
        "Не важно": "task-blue"
      };
      body.color = colorMap[priority];
    }

    const data = await api("POST", "/tasks", body) as { id?: string; error?: string; message?: string };

    if (data.id) {
      return text(`✓ Задача создана!\nНазвание: ${title}\nID: ${data.id}`);
    }

    return text(`Ошибка создания задачи: ${data.error || data.message || JSON.stringify(data)}`);
  }
);

// Обновить задачу
server.registerTool(
  "yougile_update_task",
  {
    title: "Обновить задачу",
    description: "Обновить существующую задачу в YouGile. Можно менять название, описание, приоритет, дедлайн, колонку, исполнителей.",
    inputSchema: z.object({
      taskId: z.string().describe("ID задачи которую нужно обновить"),
      title: z.string().optional().describe("Новое название"),
      description: z.string().optional().describe("Новое описание"),
      priority: z.enum(["Важно", "Нормально", "Не важно"]).optional().describe("Новый приоритет"),
      deadline: z.string().optional().describe("Новый дедлайн YYYY-MM-DD"),
      columnId: z.string().optional().describe("Переместить в другую колонку"),
      assignee: z.string().optional().describe("ID пользователя для назначения"),
      assignees: z.array(z.string()).optional().describe("Массив ID пользователей")
    }).strict(),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  },
  async ({ taskId, title, description, priority, deadline, columnId, assignee, assignees }) => {
    const body: Record<string, unknown> = {};

    if (title) body.title = title;
    if (description) body.description = toHtml(description);
    if (columnId) body.columnId = columnId;

    const assignedIds: string[] = [];
    if (assignees?.length) assignedIds.push(...assignees);
    else if (assignee) assignedIds.push(assignee);
    if (assignedIds.length) body.assigned = assignedIds;

    if (deadline) body.deadline = { deadline: dateToTimestamp(deadline) };

    if (priority) {
      const colorMap: Record<string, string> = {
        "Важно": "task-red",
        "Нормально": "task-yellow",
        "Не важно": "task-blue"
      };
      body.color = colorMap[priority];
    }

    const data = await api("PUT", `/tasks/${taskId}`, body) as { id?: string; error?: string; message?: string };

    if (data.id) return text(`✓ Задача ${taskId} обновлена`);
    return text(`Ошибка: ${data.error || data.message || JSON.stringify(data)}`);
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
    description: "Отправить сообщение в чат задачи YouGile. Поддерживает HTML для форматирования и вставки изображений.",
    inputSchema: z.object({
      taskId: z.string().describe("ID задачи"),
      text: z.string().min(1).describe("Текст сообщения"),
      textHtml: z.string().optional().describe("Текст в формате HTML (поддерживает <img src='...'> для отображения картинок)")
    }).strict(),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }
  },
  async ({ taskId, text: msgText, textHtml }) => {
    const body = {
      text: msgText,
      textHtml: textHtml || `<p>${msgText}</p>`,
      label: ""
    };
    const data = await api("POST", `/chats/${taskId}/messages`, body) as { id?: number; error?: string; message?: string };
    if (data.id) return text(`✓ Сообщение отправлено (id: ${data.id})`);
    return text(`Ошибка: ${data.error || data.message || JSON.stringify(data)}`);
  }
);

// Загрузить изображение (base64) и прикрепить к задаче через чат
server.registerTool(
  "yougile_upload_image",
  {
    title: "Загрузить изображение в задачу",
    description: "Загружает изображение на сервер YouGile и отправляет его в чат задачи. Принимает изображение в формате base64.",
    inputSchema: z.object({
      taskId: z.string().describe("ID задачи"),
      imageBase64: z.string().describe("Содержимое изображения в формате base64 (без префикса data:...)"),
      fileName: z.string().describe("Имя файла, например screenshot.jpg"),
      mimeType: z.string().default("image/jpeg").describe("MIME-тип файла: image/jpeg, image/png и т.д."),
      caption: z.string().optional().describe("Подпись к изображению")
    }).strict(),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }
  },
  async ({ taskId, imageBase64, fileName, mimeType, caption }) => {
    const uploaded = await uploadFileBase64(imageBase64, fileName, mimeType);
    if (!uploaded) return text("Ошибка: не удалось загрузить изображение на сервер YouGile");

    const cap = caption || fileName;
    const msgText = `📎 ${cap}: ${uploaded.fullUrl}`;
    const msgHtml = `<p>${cap}</p><img src="${uploaded.fullUrl}" alt="${cap}" style="max-width:100%;" />`;

    const body = { text: msgText, textHtml: msgHtml, label: "" };
    const data = await api("POST", `/chats/${taskId}/messages`, body) as { id?: number; error?: string; message?: string };

    if (data.id) return text(`✓ Изображение загружено и отправлено в чат\nURL: ${uploaded.fullUrl}`);
    return text(`Файл загружен (${uploaded.fullUrl}), но ошибка отправки в чат: ${data.error || data.message || JSON.stringify(data)}`);
  }
);

// --- HTTP Transport ---

async function main(): Promise<void> {
  const app = express();
  app.use(express.json());

  app.get("/", (_req, res) => {
    res.json({ status: "ok", service: "YouGile MCP Server", version: "4.6.0" });
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
    console.log(`YouGile MCP сервер v4.6 запущен на порту ${PORT}`);
  });
}

main().catch(err => {
  console.error("Ошибка запуска:", err);
  process.exit(1);
});
