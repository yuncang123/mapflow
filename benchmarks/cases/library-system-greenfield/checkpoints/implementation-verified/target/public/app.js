const elements = {
  count: document.querySelector("#loan-count"),
  list: document.querySelector("#loan-list"),
  updatedAt: document.querySelector("#updated-at"),
  refresh: document.querySelector("#refresh-loans"),
  result: document.querySelector("#action-result"),
  resultKicker: document.querySelector("#result-kicker"),
  resultTitle: document.querySelector("#result-title"),
  resultDetail: document.querySelector("#result-detail"),
  loanBookId: document.querySelector("#loan-book-id"),
  loanReaderId: document.querySelector("#loan-reader-id"),
};

const errorMessages = {
  validation_error: "请检查输入内容后重试。",
  invalid_json: "提交内容无法读取。",
  book_not_found: "没有找到这册图书。",
  reader_not_found: "没有找到这位读者。",
  book_already_loaned: "这册图书当前已经借出。",
  loan_not_found: "没有找到这笔借阅。",
  loan_already_returned: "这笔借阅已经归还。",
};

function createElement(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

async function api(pathname, options = {}) {
  const response = await fetch(pathname, {
    ...options,
    headers: options.body ? { "content-type": "application/json" } : undefined,
  });
  const body = await response.json();
  if (!response.ok) {
    const error = new Error(errorMessages[body.error?.code] || "办理失败，请稍后重试。");
    error.code = body.error?.code;
    throw error;
  }
  return body;
}

function formatBorrowedAt(value) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function renderLoans(loans) {
  elements.count.textContent = String(loans.length);
  elements.list.replaceChildren();
  elements.list.setAttribute("aria-busy", "false");

  if (loans.length === 0) {
    elements.list.append(createElement("div", "empty-state", "当前没有借出的图书"));
    return;
  }

  for (const loan of loans) {
    const row = createElement("article", "loan-row");
    row.dataset.loanId = String(loan.id);

    const book = createElement("div", "loan-primary");
    book.append(createElement("strong", "", loan.book.title));
    const bookMeta = createElement(
      "span",
      "",
      `${loan.book.author || "作者未登记"} · 图书 `,
    );
    bookMeta.append(createElement("span", "loan-id", `#${loan.bookId}`));
    book.append(bookMeta);

    const reader = createElement("div", "loan-meta");
    reader.append(createElement("strong", "", loan.reader.name));
    reader.append(createElement("span", "loan-id", `读者 #${loan.readerId}`));

    const borrowedAt = createElement("time", "loan-time", formatBorrowedAt(loan.borrowedAt));
    borrowedAt.dateTime = loan.borrowedAt;

    const returnButton = createElement("button", "return-button", "归还");
    returnButton.type = "button";
    returnButton.dataset.loanId = String(loan.id);
    returnButton.dataset.bookTitle = loan.book.title;

    row.append(book, reader, borrowedAt, returnButton);
    elements.list.append(row);
  }
}

async function refreshLoans() {
  elements.refresh.disabled = true;
  elements.list.setAttribute("aria-busy", "true");
  try {
    const { loans } = await api("/api/loans?status=active");
    renderLoans(loans);
    elements.updatedAt.textContent = `更新于 ${new Intl.DateTimeFormat("zh-CN", {
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date())}`;
  } catch (error) {
    elements.count.textContent = "--";
    elements.list.replaceChildren(createElement("div", "error-state", error.message));
    elements.list.setAttribute("aria-busy", "false");
    elements.updatedAt.textContent = "读取失败";
  } finally {
    elements.refresh.disabled = false;
  }
}

function showResult(title, detail, tone = "success") {
  elements.resultKicker.textContent = tone === "error" ? "办理未完成" : "办理完成";
  elements.resultTitle.textContent = title;
  elements.resultDetail.textContent = detail;
  elements.result.classList.toggle("is-error", tone === "error");
  elements.result.hidden = false;
}

function setSubmitting(form, submitting) {
  const button = form.querySelector("button[type='submit']");
  if (!button.dataset.label) button.dataset.label = button.textContent;
  button.disabled = submitting;
  button.textContent = submitting ? "办理中…" : button.dataset.label;
}

function clearFeedback() {
  for (const message of document.querySelectorAll(".form-message")) {
    message.textContent = "";
  }
  elements.result.hidden = true;
}

function formValues(form) {
  return Object.fromEntries(new FormData(form));
}

async function submitForm(form, action) {
  const message = form.querySelector(".form-message");
  clearFeedback();
  setSubmitting(form, true);
  try {
    await action();
  } catch (error) {
    message.textContent = error.message;
  } finally {
    setSubmitting(form, false);
  }
}

document.querySelector("#book-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  submitForm(form, async () => {
    const values = formValues(form);
    const { book } = await api("/api/books", { method: "POST", body: JSON.stringify(values) });
    elements.loanBookId.value = String(book.id);
    showResult(`已登记《${book.title}》`, `图书 #${book.id}`);
    form.reset();
  });
});

document.querySelector("#reader-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  submitForm(form, async () => {
    const values = formValues(form);
    const { reader } = await api("/api/readers", { method: "POST", body: JSON.stringify(values) });
    elements.loanReaderId.value = String(reader.id);
    showResult(`已登记读者 ${reader.name}`, `读者 #${reader.id}`);
    form.reset();
  });
});

document.querySelector("#loan-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  submitForm(form, async () => {
    const values = formValues(form);
    const { loan } = await api("/api/loans", {
      method: "POST",
      body: JSON.stringify({ bookId: Number(values.bookId), readerId: Number(values.readerId) }),
    });
    showResult(`已借出《${loan.book.title}》`, `借阅 #${loan.id} · ${loan.reader.name}`);
    form.reset();
    await refreshLoans();
  });
});

elements.list.addEventListener("click", async (event) => {
  const button = event.target.closest(".return-button");
  if (!button) return;

  clearFeedback();
  button.disabled = true;
  const originalText = button.textContent;
  button.textContent = "办理中…";
  try {
    const { loan } = await api("/api/returns", {
      method: "POST",
      body: JSON.stringify({ loanId: Number(button.dataset.loanId) }),
    });
    showResult(`已归还《${loan.book.title}》`, `借阅 #${loan.id}`);
    await refreshLoans();
  } catch (error) {
    showResult("归还未完成", error.message, "error");
    button.disabled = false;
    button.textContent = originalText;
  }
});

const tabs = [...document.querySelectorAll("[role='tab']")];

function activateTab(tab, focus = false) {
  for (const candidate of tabs) {
    const selected = candidate === tab;
    candidate.setAttribute("aria-selected", String(selected));
    candidate.tabIndex = selected ? 0 : -1;
    document.querySelector(`#panel-${candidate.dataset.panel}`).hidden = !selected;
  }
  if (focus) tab.focus();
}

for (const [index, tab] of tabs.entries()) {
  tab.addEventListener("click", () => activateTab(tab));
  tab.addEventListener("keydown", (event) => {
    const targetIndex = {
      ArrowLeft: (index - 1 + tabs.length) % tabs.length,
      ArrowRight: (index + 1) % tabs.length,
      Home: 0,
      End: tabs.length - 1,
    }[event.key];
    if (targetIndex === undefined) return;
    event.preventDefault();
    activateTab(tabs[targetIndex], true);
  });
}

elements.refresh.addEventListener("click", refreshLoans);
refreshLoans();
