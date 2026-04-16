"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../lib/supabase";
import * as XLSX from "xlsx";

const STATUS_OPTIONS = [
  "Новый",
  "В работе",
  "В пути",
  "Поставлен",
  "Отменен",
];

const ORDER_TYPE_OPTIONS = ["Стандартный", "Срочный"] as const;

type OrderHeader = {
  id: number;
  client_order: string | null;
  order_date: string | null;
  order_type: string | null;
  planned_date: string | null;
  status: string | null;
  delivered_date: string | null;
  comment: string | null;
  updated_by: string | null;
  updated_at: string | null;
};

type OrderItem = {
  id: number;
  order_id: number;
  article: string | null;
  replacement_article: string | null;
  name: string | null;
  quantity: string | null;
  planned_date: string | null;
  status: string | null;
  delivered_date: string | null;
  canceled_date: string | null;
};

type OrderWithItems = OrderHeader & {
  order_items?: OrderItem[];
};

type ItemForm = {
  id?: number;
  article: string;
  hasReplacement: boolean;
  replacementArticle: string;
  name: string;
  quantity: string;
  plannedDate: string;
  status: string;
  deliveredDate: string;
  canceledDate: string;
};

type ParsedComment = {
  datetime: string;
  author: string;
  text: string;
};

type UserProfile = {
  id: string;
  email: string;
  role: "admin" | "supplier" | "viewer";
  name: string;
};

type SortField =
  | "id"
  | "client_order"
  | "order_date"
  | "order_type"
  | "status"
  | "updated_at"
  | "progress";

type SortDirection = "asc" | "desc";

const EMPTY_ITEM: ItemForm = {
  article: "",
  hasReplacement: false,
  replacementArticle: "",
  name: "",
  quantity: "",
  plannedDate: "",
  status: "Новый",
  deliveredDate: "",
  canceledDate: "",
};

function getTodayDate() {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

const EMPTY_ORDER_FORM = {
  clientOrder: "",
  orderDate: getTodayDate(),
  orderType: "Стандартный",
  comment: "",
  newComment: "",
  bulkPlannedDate: "",
  bulkStatus: "Новый",
  items: [{ ...EMPTY_ITEM }] as ItemForm[],
};

function formatDateTimeForDb(date = new Date()) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate()
  )} ${pad(date.getHours())}:${pad(date.getMinutes())}:00`;
}

function formatDate(dateString: string | null) {
  if (!dateString) return "—";

  const date = new Date(dateString);
  if (isNaN(date.getTime())) return dateString;

  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${date.getFullYear()}`;
}

function formatDateTimeForView(dateString: string | null) {
  if (!dateString) return "—";

  const date = new Date(dateString);
  if (isNaN(date.getTime())) return dateString;

  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${date.getFullYear()} ${pad(
    date.getHours()
  )}:${pad(date.getMinutes())}`;
}

function compareValues(
  a: string | number | null,
  b: string | number | null,
  direction: SortDirection
) {
  const aVal = a ?? "";
  const bVal = b ?? "";

  if (typeof aVal === "number" && typeof bVal === "number") {
    return direction === "asc" ? aVal - bVal : bVal - aVal;
  }

  const result = String(aVal).localeCompare(String(bVal), "ru", {
    numeric: true,
  });

  return direction === "asc" ? result : -result;
}

function statusClasses(status: string) {
  if (status === "Поставлен") {
    return "bg-emerald-100 text-emerald-700 border border-emerald-200";
  }
  if (status === "Отменен" || status === "Частично отменен") {
    return "bg-rose-100 text-rose-700 border border-rose-200";
  }
  if (status === "В пути") {
    return "bg-violet-100 text-violet-700 border border-violet-200";
  }
  if (status === "В работе") {
    return "bg-amber-100 text-amber-700 border border-amber-200";
  }
  return "bg-slate-100 text-slate-700 border border-slate-200";
}

function orderTypeClasses(orderType: string) {
  if (orderType === "Срочный") {
    return "bg-amber-100 text-amber-700 border border-amber-200";
  }
  return "bg-sky-100 text-sky-700 border border-sky-200";
}

function statusSelectClasses(status: string) {
  if (status === "Поставлен") {
    return "border-emerald-200 bg-emerald-50 text-emerald-700";
  }
  if (status === "Отменен") {
    return "border-rose-200 bg-rose-50 text-rose-700";
  }
  if (status === "В пути") {
    return "border-violet-200 bg-violet-50 text-violet-700";
  }
  if (status === "В работе") {
    return "border-amber-200 bg-amber-50 text-amber-700";
  }
  return "border-slate-200 bg-slate-50 text-slate-700";
}

function getOrderProgress(items: OrderItem[]) {
  const total = items.length;
  const delivered = items.filter((item) => item.status === "Поставлен").length;
  const canceled = items.filter((item) => item.status === "Отменен").length;
  const active = total - delivered - canceled;

  return { total, delivered, canceled, active };
}

function getOrderStatus(items: OrderItem[]) {
  if (items.length === 0) return "Новый";

  const statuses = items.map((item) => item.status || "Новый");
  const total = statuses.length;
  const deliveredCount = statuses.filter((s) => s === "Поставлен").length;
  const canceledCount = statuses.filter((s) => s === "Отменен").length;

  if (deliveredCount === total) return "Поставлен";
  if (canceledCount === total) return "Отменен";
  if (canceledCount > 0) return "Частично отменен";
  if (deliveredCount > 0) return "Частично поставлен";
  if (statuses.includes("В пути")) return "В пути";
  if (statuses.includes("В работе")) return "В работе";
  return "Новый";
}

function getOrderPlannedDate(items: OrderItem[]) {
  const dates = items.map((item) => item.planned_date).filter(Boolean).sort();
  return dates[dates.length - 1] || null;
}

function getOrderDeliveredDate(items: OrderItem[]) {
  const allDelivered =
    items.length > 0 && items.every((item) => item.status === "Поставлен");

  if (!allDelivered) return null;

  const dates = items.map((item) => item.delivered_date).filter(Boolean).sort();
  return dates[dates.length - 1] || null;
}

function isItemOverdue(item: OrderItem) {
  return !!(
    item.planned_date &&
    item.status !== "Поставлен" &&
    item.status !== "Отменен" &&
    new Date(item.planned_date) < new Date(new Date().toDateString())
  );
}

function isOrderOverdue(items: OrderItem[]) {
  return items.some((item) => isItemOverdue(item));
}

function hasComment(comment: string | null) {
  return !!comment?.trim();
}

function hasReplacementInOrder(items: OrderItem[]) {
  return items.some((item) => !!item.replacement_article?.trim());
}

function buildCommentEntry(author: string, text: string) {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const prettyDate = `${pad(now.getDate())}.${pad(now.getMonth() + 1)}.${now.getFullYear()} ${pad(
    now.getHours()
  )}:${pad(now.getMinutes())}`;

  return `[${prettyDate}] ${author}:\n${text.trim()}`;
}

function mergeComments(existing: string | null, author: string, newText: string) {
  const trimmed = newText.trim();
  if (!trimmed) return existing || "";
  const entry = buildCommentEntry(author, trimmed);
  return [existing?.trim(), entry].filter(Boolean).join("\n\n");
}

function appendCommentEntries(existing: string | null, entries: string[]) {
  const cleanEntries = entries.map((x) => x.trim()).filter(Boolean);
  if (cleanEntries.length === 0) return existing || "";
  return [existing?.trim(), ...cleanEntries].filter(Boolean).join("\n\n");
}

function parseComments(commentText: string | null): ParsedComment[] {
  if (!commentText?.trim()) return [];

  const blocks = commentText.split(/\n\s*\n/g).filter(Boolean);

  return blocks.map((block) => {
    const lines = block.split("\n");
    const firstLine = lines[0] || "";
    const messageText = lines.slice(1).join("\n").trim();
    const match = firstLine.match(/^\[(.+?)\]\s+(.+?):$/);

    if (match) {
      return {
        datetime: match[1],
        author: match[2],
        text: messageText || "",
      };
    }

    return {
      datetime: "",
      author: "Система",
      text: block,
    };
  });
}

function getCellValue(row: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    if (row[key] !== undefined && row[key] !== null && String(row[key]).trim() !== "") {
      return String(row[key]).trim();
    }
  }
  return "";
}

function parseExcelItems(rows: Record<string, unknown>[]): ItemForm[] {
  const items = rows
    .map((row) => {
      const article = getCellValue(row, ["Артикул", "артикул", "Article", "article"]);
      const name = getCellValue(row, ["Наименование", "наименование", "Name", "name"]);
      const quantity = getCellValue(row, [
        "Количество",
        "количество",
        "Quantity",
        "quantity",
        "qty",
        "Кол-во всего",
      ]);

      return {
        article,
        hasReplacement: false,
        replacementArticle: "",
        name,
        quantity,
        plannedDate: "",
        status: "Новый",
        deliveredDate: "",
        canceledDate: "",
      };
    })
    .filter((item) => item.article || item.name || item.quantity);

  return items;
}

export default function OrdersPage() {
  const [orders, setOrders] = useState<OrderWithItems[]>([]);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [orderTypeFilter, setOrderTypeFilter] = useState("all");
  const [open, setOpen] = useState(false);
  const [editingOrderId, setEditingOrderId] = useState<number | null>(null);
  const [form, setForm] = useState(EMPTY_ORDER_FORM);
  const [loading, setLoading] = useState(true);
  const [authLoading, setAuthLoading] = useState(true);
  const [profileLoading, setProfileLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [copiedArticle, setCopiedArticle] = useState<string | null>(null);
  const [expandedOrders, setExpandedOrders] = useState<number[]>([]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [sortField, setSortField] = useState<SortField>("id");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");

  const [user, setUser] = useState<UserProfile | null>(null);

  const [loginForm, setLoginForm] = useState({
    login: "",
    password: "",
  });
  const [loginError, setLoginError] = useState("");

  const isEditing = !!editingOrderId;

  useEffect(() => {
    if (!copiedArticle) return;
    const timer = setTimeout(() => setCopiedArticle(null), 1500);
    return () => clearTimeout(timer);
  }, [copiedArticle]);

  const fetchProfile = async (userId: string): Promise<UserProfile | null> => {
    const cacheKey = `profile-${userId}`;

    try {
      const cached =
        typeof window !== "undefined" ? window.localStorage.getItem(cacheKey) : null;

      if (cached) {
        const parsed = JSON.parse(cached) as UserProfile;

        setTimeout(async () => {
          const { data, error } = await supabase
            .from("profiles")
            .select("id, email, full_name, role")
            .eq("id", userId)
            .single();

          if (!error && data && typeof window !== "undefined") {
            const freshProfile: UserProfile = {
              id: data.id,
              email: data.email,
              role: data.role,
              name: data.full_name,
            };
            window.localStorage.setItem(cacheKey, JSON.stringify(freshProfile));
          }
        }, 0);

        return parsed;
      }
    } catch (e) {
      console.error("Ошибка чтения кэша профиля:", e);
    }

    const { data, error } = await supabase
      .from("profiles")
      .select("id, email, full_name, role")
      .eq("id", userId)
      .single();

    if (error || !data) {
      console.error("Ошибка профиля:", error);
      return null;
    }

    const profile: UserProfile = {
      id: data.id,
      email: data.email,
      role: data.role,
      name: data.full_name,
    };

    try {
      if (typeof window !== "undefined") {
        window.localStorage.setItem(cacheKey, JSON.stringify(profile));
      }
    } catch (e) {
      console.error("Ошибка записи кэша профиля:", e);
    }

    return profile;
  };

  useEffect(() => {
    let mounted = true;

    const initAuth = async () => {
      setAuthLoading(true);

      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!mounted) return;

      if (!session?.user) {
        setUser(null);
        setAuthLoading(false);
        return;
      }

      setAuthLoading(false);
      setProfileLoading(true);

      const profile = await fetchProfile(session.user.id);

      if (!mounted) return;

      setUser(profile);
      setProfileLoading(false);
    };

    initAuth();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (_event, session) => {
      if (!mounted) return;

      if (!session?.user) {
        setUser(null);
        setProfileLoading(false);
        return;
      }

      setProfileLoading(true);
      const profile = await fetchProfile(session.user.id);

      if (!mounted) return;

      setUser(profile);
      setProfileLoading(false);
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  const loadOrders = async () => {
    setLoading(true);

    const { data, error } = await supabase
      .from("orders_v2")
      .select("*, order_items(*)")
      .order("id", { ascending: false });

    if (error) {
      console.error("Ошибка загрузки:", error);
      alert("Ошибка загрузки: " + error.message);
    } else {
      setOrders((data as OrderWithItems[]) || []);
    }

    setLoading(false);
  };

  useEffect(() => {
    if (user) {
      loadOrders();
    } else {
      setOrders([]);
    }
  }, [user]);

  const filteredOrders = useMemo(() => {
    const filtered = orders.filter((order) => {
      const items = order.order_items || [];
      const itemsText = items
        .map(
          (item) =>
            `${item.article || ""} ${item.replacement_article || ""} ${item.name || ""} ${item.status || ""}`
        )
        .join(" ")
        .toLowerCase();

      const orderStatus = getOrderStatus(items);
      const text =
        `${order.client_order || ""} ${order.order_type || ""} ${itemsText}`.toLowerCase();

      const matchesSearch = text.includes(search.toLowerCase());
      const matchesStatus = statusFilter === "all" ? true : orderStatus === statusFilter;
      const matchesType =
        orderTypeFilter === "all" ? true : (order.order_type || "Стандартный") === orderTypeFilter;

      return matchesSearch && matchesStatus && matchesType;
    });

    return [...filtered].sort((a, b) => {
      const aItems = a.order_items || [];
      const bItems = b.order_items || [];
      const aStatus = getOrderStatus(aItems);
      const bStatus = getOrderStatus(bItems);
      const aProgress = getOrderProgress(aItems).delivered;
      const bProgress = getOrderProgress(bItems).delivered;

      switch (sortField) {
        case "id":
          return compareValues(a.id, b.id, sortDirection);
        case "client_order":
          return compareValues(a.client_order, b.client_order, sortDirection);
        case "order_date":
          return compareValues(a.order_date, b.order_date, sortDirection);
        case "order_type":
          return compareValues(a.order_type, b.order_type, sortDirection);
        case "status":
          return compareValues(aStatus, bStatus, sortDirection);
        case "updated_at":
          return compareValues(a.updated_at, b.updated_at, sortDirection);
        case "progress":
          return compareValues(aProgress, bProgress, sortDirection);
        default:
          return 0;
      }
    });
  }, [orders, search, statusFilter, orderTypeFilter, sortField, sortDirection]);

  const stats = useMemo(() => {
    return {
      total: orders.length,
      inProgress: orders.filter((order) =>
        ["Новый", "В работе", "В пути", "Частично поставлен", "Частично отменен"].includes(
          getOrderStatus(order.order_items || [])
        )
      ).length,
      delivered: orders.filter(
        (order) => getOrderStatus(order.order_items || []) === "Поставлен"
      ).length,
      overdue: orders.filter((order) => isOrderOverdue(order.order_items || [])).length,
    };
  }, [orders]);

  const login = async () => {
    setLoginError("");

    const { error } = await supabase.auth.signInWithPassword({
      email: loginForm.login.trim(),
      password: loginForm.password.trim(),
    });

    if (error) {
      setLoginError("Неверный email или пароль");
      return;
    }

    const {
      data: { user: authUser },
    } = await supabase.auth.getUser();

    if (!authUser) {
      setLoginError("Не удалось получить пользователя");
      return;
    }

    setProfileLoading(true);
    const profile = await fetchProfile(authUser.id);

    if (!profile) {
      setLoginError("Профиль пользователя не найден");
      await supabase.auth.signOut();
      setProfileLoading(false);
      return;
    }

    setUser(profile);
    setProfileLoading(false);
    setLoginError("");
  };

  const logout = async () => {
    if (user && typeof window !== "undefined") {
      window.localStorage.removeItem(`profile-${user.id}`);
    }

    await supabase.auth.signOut();
    setUser(null);
    setLoginForm({ login: "", password: "" });
  };

  const resetForm = () => {
    setForm({
      ...EMPTY_ORDER_FORM,
      orderDate: getTodayDate(),
      items: [{ ...EMPTY_ITEM }],
    });
    setEditingOrderId(null);
  };

  const openCreate = () => {
    if (user?.role !== "admin") return;

    setEditingOrderId(null);
    setForm({
      ...EMPTY_ORDER_FORM,
      orderDate: getTodayDate(),
      items: [{ ...EMPTY_ITEM }],
    });
    setOpen(true);
  };

  const openEdit = (order: OrderWithItems) => {
    if (user?.role === "viewer") return;

    setEditingOrderId(order.id);
    setForm({
      clientOrder: order.client_order || "",
      orderDate: order.order_date || "",
      orderType: order.order_type || "Стандартный",
      comment: order.comment || "",
      newComment: "",
      bulkPlannedDate: getOrderPlannedDate(order.order_items || []) || "",
      bulkStatus: "Новый",
      items:
        order.order_items?.map((item) => ({
          id: item.id,
          article: item.article || "",
          hasReplacement: !!item.replacement_article,
          replacementArticle: item.replacement_article || "",
          name: item.name || "",
          quantity: item.quantity || "",
          plannedDate: item.planned_date || "",
          status: item.status || "Новый",
          deliveredDate: item.delivered_date || "",
          canceledDate: item.canceled_date || "",
        })) || [{ ...EMPTY_ITEM }],
    });
    setOpen(true);
  };

  const canEditOrderTextFields = () => user?.role === "admin";
  const canEditItemMainFields = () => user?.role === "admin";
  const canImportItems = () => user?.role === "admin";
  const canEditItemStatusFields = () =>
    user?.role === "admin" || user?.role === "supplier";
  const canComment = () => !!user && user.role !== "viewer";

  const updateItemField = (
    index: number,
    field: keyof ItemForm,
    value: string | boolean
  ) => {
    setForm((prev) => {
      const updatedItems = [...prev.items];
      const current = updatedItems[index];

      const nextItem = {
        ...current,
        [field]: value,
      } as ItemForm;

      if (field === "status") {
        if (value !== "Поставлен") {
          nextItem.deliveredDate = "";
        }

        if (value === "Отменен") {
          nextItem.canceledDate = getTodayDate();
        } else {
          nextItem.canceledDate = "";
        }
      }

      if (field === "hasReplacement" && value === false) {
        nextItem.replacementArticle = "";
      }

      updatedItems[index] = nextItem;

      return { ...prev, items: updatedItems };
    });
  };

  const applyBulkPlannedDate = () => {
    if (!form.bulkPlannedDate) {
      alert("Сначала выбери плановую дату");
      return;
    }

    setForm((prev) => ({
      ...prev,
      items: prev.items.map((item) => ({
        ...item,
        plannedDate: prev.bulkPlannedDate,
      })),
    }));
  };

  const applyBulkStatus = () => {
    if (!form.bulkStatus) {
      alert("Сначала выбери статус");
      return;
    }

    setForm((prev) => ({
      ...prev,
      items: prev.items.map((item) => ({
        ...item,
        status: prev.bulkStatus,
        deliveredDate: prev.bulkStatus === "Поставлен" ? item.deliveredDate : "",
        canceledDate: prev.bulkStatus === "Отменен" ? getTodayDate() : "",
      })),
    }));
  };

  const addItemRow = () => {
    setForm((prev) => ({
      ...prev,
      items: [...prev.items, { ...EMPTY_ITEM }],
    }));
  };

  const removeItemRow = (index: number) => {
    setForm((prev) => {
      if (prev.items.length === 1) {
        return {
          ...prev,
          items: [{ ...EMPTY_ITEM }],
        };
      }

      return {
        ...prev,
        items: prev.items.filter((_, i) => i !== index),
      };
    });
  };

  const handleExcelUpload = async (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const arrayBuffer = await file.arrayBuffer();
      const workbook = XLSX.read(arrayBuffer, { type: "array" });
      const firstSheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[firstSheetName];
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(worksheet, {
        defval: "",
      });

      const importedItems = parseExcelItems(rows);

      if (importedItems.length === 0) {
        alert(
          "Не удалось найти данные. Проверь, чтобы в Excel были колонки Артикул, Наименование, Количество"
        );
        return;
      }

      setForm((prev) => {
        const hasOnlyEmptyRow =
          prev.items.length === 1 &&
          !prev.items[0].article &&
          !prev.items[0].name &&
          !prev.items[0].quantity &&
          !prev.items[0].plannedDate &&
          !prev.items[0].deliveredDate &&
          !prev.items[0].canceledDate &&
          !prev.items[0].replacementArticle;

        const preparedItems = importedItems.map((item) => ({
          ...item,
          plannedDate: prev.bulkPlannedDate || item.plannedDate,
          status: prev.bulkStatus || item.status,
        }));

        return {
          ...prev,
          items: hasOnlyEmptyRow ? preparedItems : [...prev.items, ...preparedItems],
        };
      });

      alert(`Загружено позиций: ${importedItems.length}`);
    } catch (error) {
      console.error(error);
      alert("Не удалось прочитать Excel-файл");
    } finally {
      if (event.target) {
        event.target.value = "";
      }
    }
  };

  const saveForm = async () => {
    if (!user) return;
    if (saving) return;

    if (user.role === "viewer") {
      alert("Наблюдатель не может редактировать заказы");
      return;
    }

    if (user.role === "supplier" && !editingOrderId) {
      alert("Поставщик не может создавать новые заказы");
      return;
    }

    if (!form.clientOrder) {
      alert("Укажи номер клиентского заказа");
      return;
    }

    setSaving(true);

    try {
      const validItems = form.items.filter(
        (item) =>
          item.article.trim() ||
          item.name.trim() ||
          item.quantity.trim() ||
          item.plannedDate.trim() ||
          item.deliveredDate.trim() ||
          item.canceledDate.trim() ||
          item.replacementArticle.trim()
      );

      if (validItems.length === 0) {
        alert("Добавь хотя бы одну позицию");
        return;
      }

      const existingOrder = editingOrderId
        ? orders.find((x) => x.id === editingOrderId)
        : null;

      const existingItemsMap = new Map<number, OrderItem>(
        (existingOrder?.order_items || []).map((item) => [item.id, item])
      );

      const autoCommentEntries: string[] = [];

      for (const item of validItems) {
        if (item.hasReplacement && !item.replacementArticle.trim()) {
          alert(
            `Для позиции "${item.article || item.name || "без названия"}" отмечена замена, но не указан актуальный артикул`
          );
          return;
        }

        if (item.status === "Поставлен" && !item.deliveredDate) {
          alert(
            `Для позиции "${item.article || item.name || "без названия"}" со статусом 'Поставлен' нужно указать дату поставки`
          );
          return;
        }

        if (item.status === "Отменен" && !item.canceledDate) {
          alert(
            `Для позиции "${item.article || item.name || "без названия"}" со статусом 'Отменен' нужно указать дату отмены`
          );
          return;
        }

        if (user.role === "supplier" && isEditing && item.id) {
          const oldItem = existingItemsMap.get(item.id);

          if (oldItem) {
            const oldPlanned = oldItem.planned_date || "";
            const newPlanned = item.plannedDate || "";

            if (oldPlanned !== newPlanned) {
              const itemLabel = item.article || item.name || "без названия";
              autoCommentEntries.push(
                buildCommentEntry(
                  user.name,
                  `Позиция ${itemLabel}: изменена плановая дата поставки. Было: ${formatDate(
                    oldPlanned || null
                  )}. Стало: ${formatDate(newPlanned || null)}`
                )
              );
            }

            const oldStatus = oldItem.status || "Новый";
            const newStatus = item.status || "Новый";

            if (oldStatus !== "Отменен" && newStatus === "Отменен") {
              const reason = window.prompt(
                `Укажи причину отмены для позиции "${item.article || item.name || "без названия"}":`
              );

              if (!reason || !reason.trim()) {
                alert("Для отмены поставки нужно обязательно указать причину");
                return;
              }

              const itemLabel = item.article || item.name || "без названия";
              autoCommentEntries.push(
                buildCommentEntry(
                  user.name,
                  `Позиция ${itemLabel}: статус изменен на "Отменен". Причина: ${reason.trim()}`
                )
              );
            }
          }
        }
      }

      if (isEditing) {
        const invalidItems = validItems.some((item) => !item.id);
        if (invalidItems) {
          alert("Нельзя добавлять новые позиции в уже созданный заказ");
          return;
        }
      }

      let nextComment = form.comment || "";

      if (autoCommentEntries.length > 0) {
        nextComment = appendCommentEntries(nextComment, autoCommentEntries);
      }

      if (form.newComment.trim()) {
        nextComment = mergeComments(nextComment, user.name, form.newComment);
      }

      const headerPayload = {
        client_order: form.clientOrder,
        order_date: form.orderDate || null,
        order_type: form.orderType,
        comment: nextComment,
        updated_by: user.name,
        updated_at: formatDateTimeForDb(),
      };

      let orderId = editingOrderId;

      if (editingOrderId) {
        const { error } = await supabase
          .from("orders_v2")
          .update({
            client_order: headerPayload.client_order,
            order_date: headerPayload.order_date,
            comment: headerPayload.comment,
            updated_by: headerPayload.updated_by,
            updated_at: headerPayload.updated_at,
          })
          .eq("id", editingOrderId);

        if (error) {
          console.error("Ошибка обновления заказа:", error);
          alert("Ошибка обновления заказа: " + error.message);
          return;
        }
      } else {
        const { data, error } = await supabase
          .from("orders_v2")
          .insert(headerPayload)
          .select()
          .single();

        if (error) {
          console.error("Ошибка создания заказа:", error);
          alert("Ошибка создания заказа: " + error.message);
          return;
        }

        orderId = data.id;
      }

      if (!orderId) {
        alert("Не удалось определить ID заказа");
        return;
      }

      const existingItemIds =
        orders.find((x) => x.id === orderId)?.order_items?.map((x) => x.id) || [];
      const currentItemIds = validItems
        .map((item) => item.id)
        .filter(Boolean) as number[];

      const itemIdsToDelete = existingItemIds.filter((id) => !currentItemIds.includes(id));

      if (itemIdsToDelete.length > 0) {
        if (user.role !== "admin" || isEditing) {
          alert("Нельзя удалять позиции в уже созданном заказе");
          return;
        }

        const { error } = await supabase
          .from("order_items")
          .delete()
          .in("id", itemIdsToDelete);

        if (error) {
          console.error("Ошибка удаления позиций:", error);
          alert("Ошибка удаления позиций: " + error.message);
          return;
        }
      }

      for (const item of validItems) {
        const itemPayload = {
          order_id: orderId,
          article: item.article,
          replacement_article: item.hasReplacement ? item.replacementArticle : null,
          name: item.name,
          quantity: item.quantity,
          planned_date: item.plannedDate || null,
          status: item.status,
          delivered_date: item.deliveredDate || null,
          canceled_date: item.canceledDate || null,
        };

        if (item.id) {
          const { error } = await supabase
            .from("order_items")
            .update(itemPayload)
            .eq("id", item.id);

          if (error) {
            console.error("Ошибка обновления позиции:", error);
            alert("Ошибка обновления позиции: " + error.message);
            return;
          }
        } else {
          const { error } = await supabase.from("order_items").insert(itemPayload);

          if (error) {
            console.error("Ошибка добавления позиции:", error);
            alert("Ошибка добавления позиции: " + error.message);
            return;
          }
        }
      }

      setOpen(false);
      resetForm();
      await loadOrders();
    } finally {
      setSaving(false);
    }
  };

  const removeOrder = async (id: number) => {
    if (user?.role !== "admin") {
      alert("Удалять заказы может только администратор");
      return;
    }

    const { error: itemsError } = await supabase
      .from("order_items")
      .delete()
      .eq("order_id", id);

    if (itemsError) {
      console.error("Ошибка удаления позиций:", itemsError);
      alert("Ошибка удаления позиций: " + itemsError.message);
      return;
    }

    const { error: orderError } = await supabase
      .from("orders_v2")
      .delete()
      .eq("id", id);

    if (orderError) {
      console.error("Ошибка удаления заказа:", orderError);
      alert("Ошибка удаления заказа: " + orderError.message);
      return;
    }

    setExpandedOrders((prev) => prev.filter((x) => x !== id));
    loadOrders();
  };

  const updateItemStatusQuick = async (
    orderId: number,
    item: OrderItem,
    newStatus: string
  ) => {
    if (!user) return;

    if (user.role === "viewer") {
      alert("Наблюдатель не может менять статус");
      return;
    }

    if (newStatus === "Поставлен" && !item.delivered_date) {
      alert(
        "Для статуса 'Поставлен' сначала открой 'Изменить' и укажи дату поставки у позиции"
      );
      openEdit(orders.find((x) => x.id === orderId)!);
      return;
    }

    if (newStatus === "Отменен" && !item.canceled_date) {
      alert(
        "Для статуса 'Отменен' сначала открой 'Изменить' и укажи дату отмены у позиции"
      );
      openEdit(orders.find((x) => x.id === orderId)!);
      return;
    }

    let nextComment = orders.find((x) => x.id === orderId)?.comment || "";

    if (newStatus === "Отменен" && user.role === "supplier") {
      const reason = window.prompt(
        `Укажи причину отмены для позиции "${item.article || item.name || "без названия"}":`
      );

      if (!reason || !reason.trim()) {
        alert("Для отмены поставки нужно обязательно указать причину");
        return;
      }

      const itemLabel = item.article || item.name || "без названия";
      nextComment = appendCommentEntries(nextComment, [
        buildCommentEntry(
          user.name,
          `Позиция ${itemLabel}: статус изменен на "Отменен". Причина: ${reason.trim()}`
        ),
      ]);
    }

    const { error } = await supabase
      .from("order_items")
      .update({ status: newStatus })
      .eq("id", item.id);

    if (error) {
      console.error("Ошибка обновления статуса позиции:", error);
      alert("Ошибка обновления статуса позиции: " + error.message);
      return;
    }

    const { error: orderError } = await supabase
      .from("orders_v2")
      .update({
        updated_by: user.name,
        updated_at: formatDateTimeForDb(),
        comment: nextComment,
      })
      .eq("id", orderId);

    if (orderError) {
      console.error("Ошибка обновления заказа:", orderError);
      alert("Ошибка обновления заказа: " + orderError.message);
      return;
    }

    setOrders((prev) =>
      prev.map((order) =>
        order.id === orderId
          ? {
              ...order,
              updated_by: user.name,
              updated_at: formatDateTimeForDb(),
              comment: nextComment,
              order_items: (order.order_items || []).map((row) =>
                row.id === item.id ? { ...row, status: newStatus } : row
              ),
            }
          : order
      )
    );
  };

  const copyArticle = async (article: string | null) => {
    if (!article) return;

    try {
      await navigator.clipboard.writeText(article);
      setCopiedArticle(article);
    } catch {
      alert("Не удалось скопировать артикул");
    }
  };

  const toggleOrderExpand = (orderId: number) => {
    setExpandedOrders((prev) =>
      prev.includes(orderId)
        ? prev.filter((x) => x !== orderId)
        : [...prev, orderId]
    );
  };

  if (authLoading) {
    return (
      <div className="min-h-screen bg-slate-100 flex items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-slate-300 border-t-slate-700" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-slate-100 p-4 md:p-8 flex items-center justify-center">
        <div className="w-full max-w-md rounded-3xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
          <h1 className="text-2xl font-bold text-slate-900">Вход в систему</h1>

          <div className="mt-6 space-y-4">
            <div>
              <label className="mb-2 block text-sm font-medium text-slate-700">
                Email
              </label>
              <input
                type="email"
                value={loginForm.login}
                onChange={(e) => setLoginForm({ ...loginForm, login: e.target.value })}
                className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none focus:border-slate-400"
              />
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-slate-700">
                Пароль
              </label>
              <input
                type="password"
                value={loginForm.password}
                onChange={(e) => setLoginForm({ ...loginForm, password: e.target.value })}
                className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none focus:border-slate-400"
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    login();
                  }
                }}
              />
            </div>

            {loginError ? (
              <div className="rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700">
                {loginError}
              </div>
            ) : null}

            <button
              onClick={login}
              className="w-full rounded-xl bg-slate-900 px-4 py-3 text-sm font-medium text-white hover:bg-slate-800"
            >
              Войти
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-100 p-4 md:p-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <div className="rounded-3xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-slate-900 md:text-3xl">
                Общая таблица заказов
              </h1>
              <p className="mt-2 text-sm text-slate-500">
                Система обработки и мониторинга заказов Автодом - Союз.
              </p>
            </div>

            <div className="flex flex-col gap-3 lg:items-end">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm text-slate-500">Пользователь:</span>
                <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm">
                  {profileLoading
                    ? "Загрузка профиля..."
                    : `${user.name} · ${
                        user.role === "admin"
                          ? "Администратор"
                          : user.role === "supplier"
                          ? "Поставщик"
                          : "Наблюдатель"
                      }`}
                </div>
                <button
                  onClick={logout}
                  className="rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
                >
                  Выйти
                </button>
              </div>

              {user.role === "admin" ? (
                <button
                  onClick={openCreate}
                  className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-800"
                >
                  Добавить заказ
                </button>
              ) : null}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
          <StatCard title="Всего заказов" value={stats.total} />
          <StatCard title="В работе" value={stats.inProgress} />
          <StatCard title="Поставлено" value={stats.delivered} />
          <StatCard title="Просрочено" value={stats.overdue} />
        </div>

        <div className="rounded-3xl bg-white p-4 shadow-sm ring-1 ring-slate-200 md:p-6">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Поиск по номеру заказа, типу заказа, артикулу, замене, наименованию"
              className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none placeholder:text-slate-400 focus:border-slate-400 xl:max-w-md"
            />

            <div className="flex flex-col gap-3 sm:flex-row">
              <select
                value={orderTypeFilter}
                onChange={(e) => setOrderTypeFilter(e.target.value)}
                className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none focus:border-slate-400"
              >
                <option value="all">Все типы</option>
                {ORDER_TYPE_OPTIONS.map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </select>

              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none focus:border-slate-400"
              >
                <option value="all">Все статусы</option>
                {[
                  "Новый",
                  "В работе",
                  "В пути",
                  "Поставлен",
                  "Отменен",
                  "Частично поставлен",
                  "Частично отменен",
                ].map((status) => (
                  <option key={status} value={status}>
                    {status}
                  </option>
                ))}
              </select>

              <select
                value={`${sortField}:${sortDirection}`}
                onChange={(e) => {
                  const [field, direction] = e.target.value.split(":") as [
                    SortField,
                    SortDirection
                  ];
                  setSortField(field);
                  setSortDirection(direction);
                }}
                className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none focus:border-slate-400"
              >
                <option value="id:desc">Сначала новые</option>
                <option value="id:asc">Сначала старые</option>
                <option value="order_date:asc">Дата заказа ↑</option>
                <option value="order_date:desc">Дата заказа ↓</option>
                <option value="order_type:asc">Тип А-Я</option>
                <option value="order_type:desc">Тип Я-А</option>
                <option value="status:asc">Статус А-Я</option>
                <option value="status:desc">Статус Я-А</option>
                <option value="client_order:asc">№ заказа А-Я</option>
                <option value="client_order:desc">№ заказа Я-А</option>
                <option value="progress:desc">Больше поставлено</option>
                <option value="progress:asc">Меньше поставлено</option>
                <option value="updated_at:desc">Свежее изменение</option>
                <option value="updated_at:asc">Старое изменение</option>
              </select>
            </div>
          </div>
        </div>

        <div className="overflow-hidden rounded-3xl bg-white shadow-sm ring-1 ring-slate-200">
          <div className="overflow-x-auto">
            <table className="min-w-[1140px] w-full text-left text-sm">
              <thead className="sticky top-0 z-10 bg-slate-50 text-slate-600 shadow-sm">
                <tr>
                  <th className="px-4 py-3 font-semibold">Заказ</th>
                  <th className="px-4 py-3 font-semibold">Тип</th>
                  <th className="px-4 py-3 font-semibold">Дата заказа</th>
                  <th className="px-4 py-3 font-semibold">Общий статус</th>
                  <th className="px-4 py-3 font-semibold">Прогресс</th>
                  <th className="px-4 py-3 font-semibold">Плановая</th>
                  <th className="px-4 py-3 font-semibold">Полная поставка</th>
                  <th className="px-4 py-3 font-semibold">Последнее изменение</th>
                </tr>
              </thead>

              <tbody className="bg-white">
                {loading ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-12 text-center text-slate-500">
                      Загрузка...
                    </td>
                  </tr>
                ) : filteredOrders.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-12 text-center text-slate-500">
                      Ничего не найдено.
                    </td>
                  </tr>
                ) : (
                  filteredOrders.map((order) => {
                    const expanded = expandedOrders.includes(order.id);
                    const items = order.order_items || [];
                    const orderStatus = getOrderStatus(items);
                    const overdue = isOrderOverdue(items);
                    const progress = getOrderProgress(items);
                    const plannedDate = getOrderPlannedDate(items);
                    const fullDeliveredDate = getOrderDeliveredDate(items);
                    const orderType = order.order_type || "Стандартный";

                    return (
                      <Fragment key={order.id}>
                        <tr
                          className={`border-t border-slate-100 align-top transition ${
                            overdue
                              ? "bg-rose-50/60"
                              : orderStatus === "Поставлен"
                              ? "bg-emerald-50/60"
                              : orderType === "Срочный"
                              ? "bg-amber-50/60"
                              : "hover:bg-slate-50/70"
                          }`}
                        >
                          <td className="px-4 py-3">
                            <div className="flex items-start gap-3">
                              <div
                                className={`mt-1 h-8 w-1.5 rounded-full ${
                                  overdue
                                    ? "bg-rose-500"
                                    : orderStatus === "Поставлен"
                                    ? "bg-emerald-500"
                                    : orderType === "Срочный"
                                    ? "bg-amber-500"
                                    : orderStatus === "Отменен" || orderStatus === "Частично отменен"
                                    ? "bg-rose-400"
                                    : orderStatus === "В пути" ||
                                      orderStatus === "Частично поставлен"
                                    ? "bg-violet-500"
                                    : orderStatus === "В работе"
                                    ? "bg-amber-400"
                                    : "bg-slate-400"
                                }`}
                              />
                              <div className="min-w-0">
                                <button
                                  onClick={() => toggleOrderExpand(order.id)}
                                  className="rounded px-1 py-0.5 text-left text-sm font-semibold tracking-tight text-slate-900 transition hover:bg-slate-100"
                                >
                                  {expanded ? "▼" : "▶"} {order.client_order || "Без номера"}
                                </button>
                                <div className="mt-1 flex flex-wrap gap-2">
                                  {user.role !== "viewer" ? (
                                    <button
                                      onClick={() => openEdit(order)}
                                      className="rounded-xl border border-slate-200 px-2.5 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-50"
                                    >
                                      Изменить
                                    </button>
                                  ) : null}

                                  {user.role === "admin" ? (
                                    <button
                                      onClick={() => removeOrder(order.id)}
                                      className="rounded-xl border border-rose-200 px-2.5 py-1 text-[11px] font-medium text-rose-600 hover:bg-rose-50"
                                    >
                                      Удалить
                                    </button>
                                  ) : null}
                                </div>
                              </div>
                            </div>
                          </td>

                          <td className="px-4 py-3">
                            <div className="flex flex-col gap-1">
                              <span
                                className={`inline-flex w-fit rounded-full px-3 py-1 text-xs font-medium ${orderTypeClasses(
                                  orderType
                                )}`}
                              >
                                {orderType}
                              </span>

                              {hasComment(order.comment) ? (
                                <span className="inline-flex w-fit rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-medium text-slate-600">
                                  Есть комментарий
                                </span>
                              ) : null}

                              {hasReplacementInOrder(items) ? (
                                <span className="inline-flex w-fit rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700">
                                  Есть замены
                                </span>
                              ) : null}
                            </div>
                          </td>

                          <td className="px-4 py-3 text-slate-700">
                            {formatDate(order.order_date)}
                          </td>

                          <td className="px-4 py-3">
                            <span
                              className={`inline-flex rounded-full px-3 py-1 text-xs font-medium ${statusClasses(
                                orderStatus
                              )}`}
                            >
                              {orderStatus}
                            </span>
                          </td>

                          <td className="px-4 py-3">
                            <div className="flex min-w-[120px] flex-col gap-1.5">
                              <div className="text-[11px] font-medium text-slate-700">
                                {progress.delivered}/{progress.total}
                              </div>
                              <div className="flex h-2 w-full overflow-hidden rounded-full bg-slate-100">
                                <div
                                  className="bg-emerald-500"
                                  style={{
                                    width:
                                      progress.total > 0
                                        ? `${(progress.delivered / progress.total) * 100}%`
                                        : "0%",
                                  }}
                                />
                                <div
                                  className="bg-rose-500"
                                  style={{
                                    width:
                                      progress.total > 0
                                        ? `${(progress.canceled / progress.total) * 100}%`
                                        : "0%",
                                  }}
                                />
                                <div
                                  className="bg-slate-300"
                                  style={{
                                    width:
                                      progress.total > 0
                                        ? `${(progress.active / progress.total) * 100}%`
                                        : "0%",
                                  }}
                                />
                              </div>
                            </div>
                          </td>

                          <td className="px-4 py-3 text-slate-700">
                            {formatDate(plannedDate)}
                          </td>

                          <td className="px-4 py-3 text-slate-700">
                            {formatDate(fullDeliveredDate)}
                          </td>

                          <td className="px-4 py-3 text-slate-500">
                            {order.updated_at ? (
                              <div className="max-w-[130px]">
                                <div className="truncate text-xs font-medium text-slate-700">
                                  {order.updated_by || "—"}
                                </div>
                                <div className="mt-1 text-[11px]">
                                  {formatDateTimeForView(order.updated_at)}
                                </div>
                              </div>
                            ) : (
                              "—"
                            )}
                          </td>
                        </tr>

                        {expanded ? (
                          <tr className="border-t border-slate-100 bg-slate-50/70">
                            <td colSpan={8} className="px-4 py-3">
                              <div className="mb-3 flex items-center justify-between">
                                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                                  Позиции заказа
                                </div>
                                <div className="rounded-full border border-slate-200 bg-white px-3 py-1 text-[11px] font-medium text-slate-600">
                                  {items.length} шт.
                                </div>
                              </div>

                              <div className="space-y-2">
                                {items.map((item) => {
                                  const itemOverdue = isItemOverdue(item);

                                  return (
                                    <div
                                      key={item.id}
                                      className={`grid grid-cols-1 gap-3 rounded-xl border border-slate-200 bg-white p-3 shadow-[0_1px_2px_rgba(0,0,0,0.03)] md:grid-cols-[1.05fr_1.6fr_0.55fr_0.9fr_0.8fr_0.8fr_0.8fr] ${
                                        itemOverdue ? "ring-1 ring-rose-200 bg-rose-50/30" : ""
                                      }`}
                                    >
                                      <div>
                                        <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                                          Артикул
                                        </div>
                                        <button
                                          onClick={() => copyArticle(item.article)}
                                          className="rounded px-1 py-0.5 text-left text-xs font-medium text-slate-800 transition hover:bg-slate-100"
                                          title="Нажми, чтобы скопировать артикул"
                                        >
                                          {item.article || "—"}
                                        </button>

                                        {item.replacement_article ? (
                                          <div className="mt-1 space-y-1">
                                            <span className="inline-flex rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700">
                                              Замена
                                            </span>
                                            <div className="rounded-lg border border-amber-200 bg-amber-50 px-2 py-1 text-[10px] font-medium text-amber-700">
                                              Актуальный артикул: {item.replacement_article}
                                            </div>
                                          </div>
                                        ) : null}

                                        {copiedArticle === item.article ? (
                                          <div className="mt-1 text-[10px] text-emerald-600">
                                            Скопировано
                                          </div>
                                        ) : null}
                                      </div>

                                      <div>
                                        <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                                          Наименование
                                        </div>
                                        <div className="text-xs text-slate-700">
                                          {item.name || "—"}
                                        </div>
                                      </div>

                                      <div>
                                        <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                                          Кол-во
                                        </div>
                                        <div className="text-xs font-medium text-slate-800">
                                          {item.quantity || "—"}
                                        </div>
                                      </div>

                                      <div>
                                        <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                                          Статус
                                        </div>
                                        {user.role === "viewer" ? (
                                          <span
                                            className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-medium ${statusClasses(
                                              item.status || "Новый"
                                            )}`}
                                          >
                                            {item.status || "Новый"}
                                          </span>
                                        ) : (
                                          <select
                                            value={item.status || "Новый"}
                                            onChange={(e) =>
                                              updateItemStatusQuick(
                                                order.id,
                                                item,
                                                e.target.value
                                              )
                                            }
                                            className={`rounded-lg border px-2.5 py-1.5 text-[11px] font-medium outline-none ${statusSelectClasses(
                                              item.status || "Новый"
                                            )}`}
                                          >
                                            {STATUS_OPTIONS.map((status) => (
                                              <option key={status} value={status}>
                                                {status}
                                              </option>
                                            ))}
                                          </select>
                                        )}
                                      </div>

                                      <div>
                                        <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                                          Плановая
                                        </div>
                                        <div className="text-xs text-slate-700">
                                          {formatDate(item.planned_date)}
                                        </div>
                                        {itemOverdue ? (
                                          <div className="mt-1 text-[10px] font-medium text-rose-600">
                                            Просрочено
                                          </div>
                                        ) : null}
                                      </div>

                                      <div>
                                        <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                                          Поставка
                                        </div>
                                        <div className="text-xs text-slate-700">
                                          {formatDate(item.delivered_date)}
                                        </div>
                                      </div>

                                      <div>
                                        <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                                          Отмена
                                        </div>
                                        <div className="text-xs text-slate-700">
                                          {formatDate(item.canceled_date)}
                                        </div>
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            </td>
                          </tr>
                        ) : null}
                      </Fragment>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        {open && (
          <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/50 p-3 md:flex md:items-center md:justify-center md:p-4">
            <div className="relative my-4 w-full max-w-6xl rounded-3xl bg-white p-4 shadow-2xl md:my-8 md:p-5">
              {saving ? (
                <div className="absolute inset-0 z-10 flex items-center justify-center rounded-3xl bg-white/70 backdrop-blur-[1px]">
                  <div className="flex flex-col items-center gap-3 rounded-2xl border border-slate-200 bg-white px-6 py-5 shadow-lg">
                    <div className="h-8 w-8 animate-spin rounded-full border-2 border-slate-300 border-t-slate-700" />
                    <div className="text-sm font-medium text-slate-700">Сохраняем заказ...</div>
                  </div>
                </div>
              ) : null}

              <div className="mb-4 flex items-start justify-between gap-3">
                <h2 className="pr-2 text-base font-semibold text-slate-900 md:text-lg">
                  {editingOrderId ? "Редактировать заказ" : "Новый заказ"}
                </h2>
                <button
                  onClick={() => !saving && setOpen(false)}
                  disabled={saving}
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
                >
                  Закрыть
                </button>
              </div>

              <div className="max-h-[78vh] overflow-y-auto pr-1">
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  <div>
                    <label className="mb-1.5 block text-sm font-medium text-slate-700">
                      Номер клиентского заказа
                    </label>
                    <input
                      value={form.clientOrder}
                      disabled={!canEditOrderTextFields() || saving}
                      onChange={(e) => setForm({ ...form, clientOrder: e.target.value })}
                      className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-slate-400 disabled:bg-slate-100 disabled:text-slate-500"
                    />
                  </div>

                  <div>
                    <label className="mb-1.5 block text-sm font-medium text-slate-700">
                      Дата заказа
                    </label>
                    <input
                      type="date"
                      value={form.orderDate}
                      disabled={!canEditOrderTextFields() || saving}
                      onChange={(e) => setForm({ ...form, orderDate: e.target.value })}
                      className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-slate-400 disabled:bg-slate-100 disabled:text-slate-500"
                    />
                  </div>

                  <div>
                    <label className="mb-1.5 block text-sm font-medium text-slate-700">
                      Тип заказа
                    </label>
                    <select
                      value={form.orderType}
                      disabled={isEditing || user?.role !== "admin" || saving}
                      onChange={(e) => setForm({ ...form, orderType: e.target.value })}
                      className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-slate-400 disabled:bg-slate-100 disabled:text-slate-500"
                    >
                      {ORDER_TYPE_OPTIONS.map((type) => (
                        <option key={type} value={type}>
                          {type}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="flex items-end">
                    {isEditing ? (
                      <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-500">
                        Тип заказа после создания не редактируется
                      </div>
                    ) : null}
                  </div>

                  {user?.role !== "viewer" ? (
                    <>
                      <div className="md:col-span-2 rounded-2xl border border-slate-200 bg-slate-50 p-3">
                        <div className="grid grid-cols-1 gap-3 md:grid-cols-[220px_auto] md:items-end">
                          <div>
                            <label className="mb-1.5 block text-sm font-medium text-slate-700">
                              Плановая дата для всех позиций
                            </label>
                            <input
                              type="date"
                              min={getTodayDate()}
                              value={form.bulkPlannedDate}
                              disabled={saving}
                              onChange={(e) =>
                                setForm({ ...form, bulkPlannedDate: e.target.value })
                              }
                              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-slate-400 disabled:bg-slate-100 disabled:text-slate-500"
                            />
                          </div>

                          <div>
                            <button
                              onClick={applyBulkPlannedDate}
                              disabled={saving}
                              className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              Применить ко всем позициям
                            </button>
                          </div>
                        </div>
                      </div>

                      <div className="md:col-span-2 rounded-2xl border border-slate-200 bg-slate-50 p-3">
                        <div className="grid grid-cols-1 gap-3 md:grid-cols-[220px_auto] md:items-end">
                          <div>
                            <label className="mb-1.5 block text-sm font-medium text-slate-700">
                              Статус для всех позиций
                            </label>
                            <select
                              value={form.bulkStatus}
                              disabled={saving}
                              onChange={(e) =>
                                setForm({ ...form, bulkStatus: e.target.value })
                              }
                              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-slate-400 disabled:bg-slate-100 disabled:text-slate-500"
                            >
                              {STATUS_OPTIONS.map((status) => (
                                <option key={status} value={status}>
                                  {status}
                                </option>
                              ))}
                            </select>
                          </div>

                          <div>
                            <button
                              onClick={applyBulkStatus}
                              disabled={saving}
                              className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              Применить статус ко всем
                            </button>
                          </div>
                        </div>
                      </div>
                    </>
                  ) : null}

                  <div className="md:col-span-2">
                    <label className="mb-1.5 block text-sm font-medium text-slate-700">
                      История комментариев
                    </label>
                    <div className="max-h-44 space-y-2 overflow-y-auto rounded-2xl border border-slate-200 bg-slate-50 p-3">
                      {parseComments(form.comment).length === 0 ? (
                        <div className="text-sm text-slate-500">Комментариев пока нет</div>
                      ) : (
                        parseComments(form.comment).map((entry, index) => (
                          <div
                            key={`${entry.datetime}-${entry.author}-${index}`}
                            className="rounded-2xl bg-white px-3 py-2 shadow-sm ring-1 ring-slate-200"
                          >
                            <div className="flex items-center justify-between gap-3">
                              <div className="text-xs font-semibold text-slate-800">
                                {entry.author}
                              </div>
                              <div className="text-[11px] text-slate-400">
                                {entry.datetime}
                              </div>
                            </div>
                            <div className="mt-1 whitespace-pre-wrap text-sm leading-5 text-slate-700">
                              {entry.text}
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>

                  <div className="md:col-span-2">
                    <label className="mb-1.5 block text-sm font-medium text-slate-700">
                      Новый комментарий
                    </label>
                    <textarea
                      value={form.newComment}
                      disabled={!canComment() || saving}
                      onChange={(e) => setForm({ ...form, newComment: e.target.value })}
                      className="min-h-[90px] w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-slate-400 disabled:bg-slate-100 disabled:text-slate-500"
                    />
                  </div>
                </div>

                <div className="mt-6">
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-base font-semibold text-slate-900">Позиции заказа</h3>

                    <div className="flex flex-wrap gap-2">
                      {!isEditing && canImportItems() ? (
                        <>
                          <input
                            ref={fileInputRef}
                            type="file"
                            accept=".xlsx,.xls"
                            onChange={handleExcelUpload}
                            className="hidden"
                          />
                          <button
                            onClick={() => fileInputRef.current?.click()}
                            disabled={saving}
                            className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            Импорт Excel
                          </button>
                        </>
                      ) : null}

                      {!isEditing && user.role === "admin" ? (
                        <button
                          onClick={addItemRow}
                          disabled={saving}
                          className="rounded-xl bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          Добавить позицию
                        </button>
                      ) : null}
                    </div>
                  </div>

                  {!isEditing ? (
                    <div className="mb-3 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500">
                      Для Excel используй колонки: <b>Артикул</b>, <b>Наименование</b>, <b>Количество</b>
                    </div>
                  ) : null}

                  <div className="space-y-3">
                    {form.items.map((item, index) => (
                      <div
                        key={item.id || `new-${index}`}
                        className="rounded-2xl border border-slate-200 p-3"
                      >
                        <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_1.35fr_0.55fr_0.85fr_0.85fr_0.85fr_0.85fr]">
                          <div>
                            <label className="mb-1.5 block text-xs font-medium text-slate-700">
                              Артикул
                            </label>
                            <input
                              value={item.article}
                              disabled={!canEditItemMainFields() || saving}
                              onChange={(e) => updateItemField(index, "article", e.target.value)}
                              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-slate-400 disabled:bg-slate-100 disabled:text-slate-500"
                            />
                          </div>

                          <div>
                            <label className="mb-1.5 block text-xs font-medium text-slate-700">
                              Наименование
                            </label>
                            <input
                              value={item.name}
                              disabled={!canEditItemMainFields() || saving}
                              onChange={(e) => updateItemField(index, "name", e.target.value)}
                              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-slate-400 disabled:bg-slate-100 disabled:text-slate-500"
                            />
                          </div>

                          <div>
                            <label className="mb-1.5 block text-xs font-medium text-slate-700">
                              Кол-во
                            </label>
                            <input
                              value={item.quantity}
                              disabled={!canEditItemMainFields() || saving}
                              onChange={(e) => updateItemField(index, "quantity", e.target.value)}
                              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-slate-400 disabled:bg-slate-100 disabled:text-slate-500"
                            />
                          </div>

                          <div>
                            <label className="mb-1.5 block text-xs font-medium text-slate-700">
                              Плановая
                            </label>
                            <input
                              type="date"
                              min={getTodayDate()}
                              value={item.plannedDate}
                              disabled={!canEditItemStatusFields() || saving}
                              onChange={(e) => updateItemField(index, "plannedDate", e.target.value)}
                              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-slate-400 disabled:bg-slate-100 disabled:text-slate-500"
                            />
                          </div>

                          <div>
                            <label className="mb-1.5 block text-xs font-medium text-slate-700">
                              Статус
                            </label>
                            <select
                              value={item.status}
                              disabled={!canEditItemStatusFields() || saving}
                              onChange={(e) => updateItemField(index, "status", e.target.value)}
                              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-slate-400 disabled:bg-slate-100 disabled:text-slate-500"
                            >
                              {STATUS_OPTIONS.map((status) => (
                                <option key={status} value={status}>
                                  {status}
                                </option>
                              ))}
                            </select>
                          </div>

                          <div>
                            <label className="mb-1.5 block text-xs font-medium text-slate-700">
                              Поставка
                            </label>
                            <input
                              type="date"
                              min={getTodayDate()}
                              value={item.deliveredDate}
                              disabled={
                                !canEditItemStatusFields() ||
                                item.status !== "Поставлен" ||
                                saving
                              }
                              onChange={(e) => updateItemField(index, "deliveredDate", e.target.value)}
                              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-slate-400 disabled:bg-slate-100 disabled:text-slate-500"
                            />
                          </div>

                          <div>
                            <label className="mb-1.5 block text-xs font-medium text-slate-700">
                              Отмена
                            </label>
                            <input
                              type="date"
                              min={getTodayDate()}
                              value={item.canceledDate}
                              disabled={
                                !canEditItemStatusFields() ||
                                item.status !== "Отменен" ||
                                saving
                              }
                              onChange={(e) => updateItemField(index, "canceledDate", e.target.value)}
                              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-slate-400 disabled:bg-slate-100 disabled:text-slate-500"
                            />
                          </div>
                        </div>

                        <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-[220px_1fr_auto] md:items-end">
                          <label className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
                            <input
                              type="checkbox"
                              checked={item.hasReplacement}
                              disabled={!canEditItemStatusFields() || saving}
                              onChange={(e) =>
                                updateItemField(index, "hasReplacement", e.target.checked)
                              }
                              className="h-4 w-4 rounded border-slate-300"
                            />
                            Есть замена
                          </label>

                          <div>
                            <label className="mb-1.5 block text-xs font-medium text-slate-700">
                              Актуальный артикул
                            </label>
                            <input
                              value={item.replacementArticle}
                              disabled={
                                !canEditItemStatusFields() ||
                                !item.hasReplacement ||
                                saving
                              }
                              onChange={(e) =>
                                updateItemField(index, "replacementArticle", e.target.value)
                              }
                              placeholder="Укажи актуальный артикул"
                              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none placeholder:text-slate-400 focus:border-slate-400 disabled:bg-slate-100 disabled:text-slate-500"
                            />
                          </div>

                          <div className="flex items-end">
                            {user?.role === "admin" && !isEditing ? (
                              <button
                                onClick={() => removeItemRow(index)}
                                disabled={saving}
                                className="w-full rounded-xl border border-rose-200 px-3 py-2 text-sm font-medium text-rose-600 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-60 md:w-auto"
                              >
                                Удалить
                              </button>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <button
                  onClick={() => !saving && setOpen(false)}
                  disabled={saving}
                  className="w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
                >
                  Отмена
                </button>
                <button
                  onClick={saveForm}
                  disabled={saving}
                  className="w-full rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
                >
                  {saving ? "Сохранение..." : "Сохранить"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function StatCard({ title, value }: { title: string; value: number }) {
  return (
    <div className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
      <div className="text-sm text-slate-500">{title}</div>
      <div className="mt-2 text-3xl font-semibold tracking-tight text-slate-900">
        {value}
      </div>
    </div>
  );
}
