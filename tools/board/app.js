const POLL_INTERVAL_MS = 1000;
const REQUEST_TIMEOUT_MS = 5000;

const STATUS_LABELS = {
  active: "实施中",
  arrived: "已到达",
  blocked: "阻塞",
  candidate: "候选",
  conflict: "冲突",
  fog: "迷雾",
  ready: "可执行",
  satisfied: "已满足",
  unsatisfied: "未满足",
  verified: "已验证",
};

const KIND_LABELS = {
  destination: "目的地",
  fog: "迷雾节点",
  join: "汇合状态",
  state: "状态节点",
};

const REACHABILITY_LABELS = {
  conditional: "条件可达",
  logical: "逻辑可达",
  unreachable: "不可达",
};

const ARRIVAL_LABELS = {
  audited: "已审计到达",
  "not-audited": "尚未实际到达",
};

const PHASE_LABELS = {
  arrived: "到达审计完成",
  implementation: "路线实施",
  replan: "局部修图",
  wayfinding: "探路建模",
};

const STRUCTURAL_LABELS = {
  complete: "结构完整",
  incomplete: "结构不完整",
};

const EVENT_LABELS = {
  arrival_audited: "到达审计完成",
  destination_approved: "目的地与路线已批准",
  edge_selected: "工作边已选中",
  edge_verification_incomplete: "工作边验收未完成",
  edge_verified: "工作边已验证",
  initialized: "运行地图已建立",
  reachability_proved: "正向可达性已证明",
  replan_requested: "地图已重新登记",
  replanned: "地图已局部修订",
};

const dom = typeof document === "undefined" ? {} : {
  announcer: document.querySelector("#announcer"),
  arrival: document.querySelector("#arrival-value"),
  canvasEmpty: document.querySelector("#canvas-empty"),
  cy: document.querySelector("#cy"),
  destination: document.querySelector("#destination-title"),
  elementList: document.querySelector("#element-list"),
  fit: document.querySelector("#fit-map"),
  freshness: document.querySelector("#freshness"),
  inspector: document.querySelector("#inspector"),
  inspectorContent: document.querySelector("#inspector-content"),
  lensButtons: [...document.querySelectorAll("[data-lens]")],
  mapCounts: document.querySelector("#map-counts"),
  phase: document.querySelector("#phase-value"),
  reachability: document.querySelector("#reachability-value"),
  relayout: document.querySelector("#relayout-map"),
  revision: document.querySelector("#revision-value"),
  search: document.querySelector("#map-search"),
  sourceBanner: document.querySelector("#source-banner"),
  syncState: document.querySelector("#sync-state"),
  timeline: document.querySelector("#timeline"),
  visibleCount: document.querySelector("#visible-count"),
};

const runtime = {
  cy: null,
  etag: null,
  lens: "proven",
  layoutCount: 0,
  model: null,
  pollTimer: null,
  query: "",
  selected: null,
  topology: null,
  trailFrame: null,
  trailOffset: 0,
};

function asText(value) {
  if (value === null || value === undefined || value === "") return "—";
  if (Array.isArray(value)) return value.length ? value.map(asText).join(" · ") : "无";
  if (typeof value === "object") return JSON.stringify(value, null, 2);
  return String(value);
}

function factValue(fact) {
  return typeof fact === "string" ? fact : fact?.value;
}

function predicateView(model, predicateId) {
  return model.predicates?.find((predicate) => predicate.id === predicateId)
    ?? model.nodes.flatMap((node) => node.predicates ?? []).find((predicate) => predicate.id === predicateId);
}

function evidenceRefs(records) {
  if (!records?.length) return "无";
  return records.map((record) => {
    const observedAt = record.observed_at ? ` · ${formatTimestamp(record.observed_at)}` : "";
    return `${record.kind ?? "evidence"}: ${record.ref ?? asText(record)}${observedAt}`;
  }).join("\n");
}

function evidenceRecord(record) {
  const checks = (record.checks ?? []).map((check) => (
    `${check.result ?? "unknown"}: ${check.command ?? "未记录检查"} → ${check.observed ?? "未记录观察"}`
  ));
  const limitations = Object.entries(record.limits ?? {})
    .filter(([, values]) => values?.length)
    .map(([kind, values]) => `${kind}: ${values.join(" · ")}`);
  return [
    `执行者：${record.executor ?? "未记录"}`,
    `时间：${formatTimestamp(record.recorded_at)}`,
    `证明：${asText(record.proves)}`,
    `验收：${asText(record.acceptance_ids)}`,
    `检查：${checks.length ? checks.join("\n") : "无"}`,
    `实现凭据：${evidenceRefs(record.outcome_refs)}`,
    `限制：${limitations.length ? limitations.join("\n") : "无未验证限制"}`,
  ].join("\n");
}

function element(tag, className = "", text = null) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== null) node.textContent = asText(text);
  return node;
}

function labeledValue(key, value, tone = "") {
  const item = element("li", `ledger-item${tone ? ` is-${tone}` : ""}`);
  item.append(element("span", "ledger-key", key), element("span", "ledger-value", value));
  return item;
}

function ledgerSection(title, items, emptyMessage = "没有记录。") {
  const section = element("section", "ledger-section");
  section.append(element("h3", "", title));
  if (!items.length) {
    section.append(element("p", "empty-note", emptyMessage));
    return section;
  }
  const list = element("ul", "ledger-list");
  list.append(...items);
  section.append(list);
  return section;
}

function statusLabel(value) {
  return STATUS_LABELS[value] ?? asText(value);
}

function statusTone(value) {
  if (["arrived", "satisfied", "verified"].includes(value)) return "teal";
  if (["active", "candidate", "ready"].includes(value)) return "amber";
  if (value === "fog") return "violet";
  if (["blocked", "conflict"].includes(value)) return "coral";
  return "";
}

function makeChip(text, tone = "") {
  return element("span", `status-chip${tone ? ` is-${tone}` : ""}`, text);
}

function hero({ eyebrow, title, id, chips = [] }) {
  const header = element("div", "inspector-hero");
  header.append(element("p", "eyebrow", eyebrow), element("h3", "", title), element("div", "inspector-id", id));
  const row = element("div", "chip-row");
  row.append(...chips);
  header.append(row);
  return header;
}

function normalizedQuery(query) {
  return query.trim().toLocaleLowerCase("zh-CN");
}

function includesQuery(values, query) {
  const needle = normalizedQuery(query);
  if (!needle) return true;
  return values.flat(Infinity).filter((value) => value !== null && value !== undefined)
    .some((value) => String(value).toLocaleLowerCase("zh-CN").includes(needle));
}

function nodeMatches(node, query) {
  return includesQuery([
    node.id,
    node.kind,
    node.label,
    node.status,
    node.predicates?.flatMap((predicate) => [predicate.id, predicate.fact, predicate.kind, predicate.actual]),
  ], query);
}

function edgeMatches(edge, query) {
  return includesQuery([
    edge.id,
    edge.title,
    edge.status,
    edge.from,
    edge.to,
    edge.preconditions,
    edge.effects,
    edge.invariants,
    edge.brief_ref,
  ], query);
}

function fogOrGapEdge(edge, model) {
  if (edge.proof_gaps?.length) return true;
  return edge.missing?.some((missing) => {
    const value = predicateView(model, missing.predicate)?.actual;
    return value === "unknown" || value === "conflict";
  }) ?? false;
}

export function topologySignature(model) {
  const nodes = model.nodes.map((node) => node.id).sort();
  const edges = model.edges.map((edge) => `${edge.id}:${edge.from}>${edge.to}`).sort();
  return JSON.stringify({ nodes, edges });
}

export function selectElementIds(model, lens = "proven", query = "") {
  const nodeIds = new Set();
  const edgeIds = new Set();
  const directMatches = new Set();

  if (lens === "all") {
    model.nodes.forEach((node) => nodeIds.add(node.id));
    model.edges.forEach((edge) => edgeIds.add(edge.id));
  } else if (lens === "fog") {
    model.nodes.filter((node) => (
      ["fog", "conflict"].includes(node.status) || (node.proof_gaps?.length ?? 0) > 0
    )).forEach((node) => nodeIds.add(node.id));
    model.edges.filter((edge) => fogOrGapEdge(edge, model)).forEach((edge) => edgeIds.add(edge.id));
  } else {
    model.edges.filter((edge) => (
      edge.proven || ["active", "verified"].includes(edge.status)
    )).forEach((edge) => edgeIds.add(edge.id));
    model.nodes.filter((node) => node.satisfied || node.kind === "destination")
      .forEach((node) => nodeIds.add(node.id));
  }

  for (const edge of model.edges) {
    if (edgeIds.has(edge.id)) {
      nodeIds.add(edge.from);
      nodeIds.add(edge.to);
    }
  }

  if (normalizedQuery(query)) {
    const matchedNodes = new Set(model.nodes.filter((node) => nodeIds.has(node.id) && nodeMatches(node, query)).map((node) => node.id));
    const matchedEdges = new Set(model.edges.filter((edge) => edgeIds.has(edge.id) && edgeMatches(edge, query)).map((edge) => edge.id));
    matchedNodes.forEach((id) => directMatches.add(id));
    matchedEdges.forEach((id) => directMatches.add(id));

    const contextualEdges = new Set(matchedEdges);
    for (const edge of model.edges) {
      if (edgeIds.has(edge.id) && (matchedNodes.has(edge.from) || matchedNodes.has(edge.to))) contextualEdges.add(edge.id);
    }
    const contextualNodes = new Set(matchedNodes);
    for (const edge of model.edges) {
      if (contextualEdges.has(edge.id)) {
        contextualNodes.add(edge.from);
        contextualNodes.add(edge.to);
      }
    }
    return {
      nodes: [...contextualNodes].sort(),
      edges: [...contextualEdges].sort(),
      matches: [...directMatches].sort(),
    };
  }

  return { nodes: [...nodeIds].sort(), edges: [...edgeIds].sort(), matches: [] };
}

function classToken(value) {
  return String(value ?? "unknown").toLowerCase().replace(/[^a-z0-9_-]/g, "-");
}

function nodeClasses(node) {
  return [
    "map-node",
    `kind-${classToken(node.kind)}`,
    `status-${classToken(node.status)}`,
    node.proof_gaps?.length ? "has-gap" : "",
  ].filter(Boolean).join(" ");
}

function edgeClasses(edge) {
  return [
    "work-edge",
    `status-${classToken(edge.status)}`,
    edge.proven ? "is-proven" : "",
    edge.candidate ? "is-candidate" : "",
    edge.proof_gaps?.length ? "has-gap" : "",
  ].filter(Boolean).join(" ");
}

function graphElements(model) {
  return [
    ...model.nodes.map((node) => ({
      group: "nodes",
      data: { id: node.id, label: node.label, kind: node.kind, status: node.status },
      classes: nodeClasses(node),
    })),
    ...model.edges.map((edge) => ({
      group: "edges",
      data: { id: edge.id, source: edge.from, target: edge.to, label: edge.title, status: edge.status },
      classes: edgeClasses(edge),
    })),
  ];
}

function cytoscapeStyles() {
  return [
    {
      selector: "node",
      style: {
        "background-color": "#f9fbfa",
        "border-color": "#82938f",
        "border-width": 1.5,
        color: "#18252d",
        "font-family": "Bahnschrift, Segoe UI, sans-serif",
        "font-size": 11,
        "font-weight": 600,
        height: 62,
        label: "data(label)",
        padding: 10,
        shape: "round-rectangle",
        "text-halign": "center",
        "text-max-width": 125,
        "text-valign": "center",
        "text-wrap": "wrap",
        width: 154,
      },
    },
    { selector: "node.kind-destination", style: { shape: "diamond", height: 94, width: 130, "text-max-width": 96 } },
    { selector: "node.kind-join", style: { shape: "hexagon", width: 142 } },
    { selector: "node.kind-fog, node.status-fog", style: { "background-color": "#e1dfeb", "border-color": "#817c9d", "border-style": "dashed" } },
    { selector: "node.status-satisfied", style: { "background-color": "#cfe7e3", "border-color": "#16766f", "border-width": 2 } },
    { selector: "node.status-arrived", style: { "background-color": "#16766f", "border-color": "#0b504b", color: "#ffffff", "border-width": 3 } },
    { selector: "node.status-conflict, node.has-gap", style: { "background-color": "#f1d5d2", "border-color": "#c8564f", "border-width": 2.5 } },
    {
      selector: "edge",
      style: {
        "arrow-scale": 0.85,
        color: "#53636a",
        "curve-style": "bezier",
        "font-family": "Cascadia Mono, Consolas, monospace",
        "font-size": 8.5,
        label: "data(label)",
        "line-color": "#82938f",
        "line-style": "solid",
        "target-arrow-color": "#82938f",
        "target-arrow-shape": "triangle",
        "text-background-color": "#edf2f1",
        "text-background-opacity": 0.86,
        "text-background-padding": 3,
        "text-margin-y": -8,
        width: 1.5,
      },
    },
    { selector: "edge.is-proven", style: { "line-color": "#53636a", "target-arrow-color": "#53636a", width: 2 } },
    { selector: "edge.status-verified", style: { "line-color": "#16766f", "target-arrow-color": "#16766f", width: 3 } },
    { selector: "edge.status-active", style: { "line-color": "#bd731d", "target-arrow-color": "#bd731d", "line-style": "dashed", "line-dash-pattern": [9, 6], width: 4 } },
    { selector: "edge.status-blocked", style: { opacity: 0.56 } },
    { selector: "edge.has-gap", style: { "line-color": "#c8564f", "target-arrow-color": "#c8564f", "line-style": "dashed", opacity: 1 } },
    { selector: ".search-match", style: { "overlay-color": "#bd731d", "overlay-opacity": 0.16, "overlay-padding": 8 } },
    { selector: ":selected", style: { "border-color": "#bd731d", "border-width": 4, "line-color": "#bd731d", "target-arrow-color": "#bd731d", "z-index": 999 } },
    { selector: ".is-hidden", style: { display: "none" } },
  ];
}

function initGraph() {
  if (runtime.cy) return runtime.cy;
  if (typeof window.cytoscape !== "function") throw new Error("Cytoscape 离线资源未加载");
  runtime.cy = window.cytoscape({
    container: dom.cy,
    elements: [],
    minZoom: 0.25,
    maxZoom: 2.4,
    pixelRatio: "auto",
    selectionType: "single",
    style: cytoscapeStyles(),
  });
  runtime.cy.on("tap", "node, edge", (event) => selectMapElement(event.target.id(), true));
  runtime.cy.on("tap", (event) => {
    if (event.target === runtime.cy) selectOverview();
  });
  if (typeof ResizeObserver === "function") {
    new ResizeObserver(() => runtime.cy?.resize()).observe(dom.cy);
  }
  startTrailAnimation();
  return runtime.cy;
}

function syncGraph(model, topologyChanged) {
  const cy = initGraph();
  cy.batch(() => {
    if (topologyChanged) {
      cy.elements().remove();
      cy.add(graphElements(model));
      return;
    }
    for (const node of model.nodes) {
      const graphNode = cy.getElementById(node.id);
      graphNode.data({ label: node.label, kind: node.kind, status: node.status });
      graphNode.classes(nodeClasses(node));
    }
    for (const edge of model.edges) {
      const graphEdge = cy.getElementById(edge.id);
      graphEdge.data({ label: edge.title, status: edge.status });
      graphEdge.classes(edgeClasses(edge));
    }
  });
}

function visibleCollection() {
  return runtime.cy?.elements().filter((item) => !item.hasClass("is-hidden")) ?? null;
}

function layoutGraph() {
  if (!runtime.cy) return;
  const visible = visibleCollection();
  if (!visible?.length) return;
  const visibleNodes = visible.nodes();
  const roots = visibleNodes.filter((node) => node.connectedEdges().filter((edge) => (
    !edge.hasClass("is-hidden") && edge.target().id() === node.id()
  )).length === 0);
  visible.layout({
    name: "breadthfirst",
    directed: true,
    fit: true,
    padding: 52,
    roots: roots.length ? roots : undefined,
    spacingFactor: 0.78,
    animate: false,
  }).run();
  runtime.layoutCount += 1;
  dom.cy.dataset.layoutCount = String(runtime.layoutCount);
}

function fitGraph() {
  const visible = visibleCollection();
  if (visible?.length) runtime.cy.fit(visible, 52);
}

function updateView({ fit = false } = {}) {
  if (!runtime.model || !runtime.cy) return;
  const selection = selectElementIds(runtime.model, runtime.lens, runtime.query);
  const visible = new Set([...selection.nodes, ...selection.edges]);
  const matches = new Set(selection.matches);
  runtime.cy.batch(() => {
    runtime.cy.elements().forEach((item) => {
      item.toggleClass("is-hidden", !visible.has(item.id()));
      item.toggleClass("search-match", matches.has(item.id()));
    });
  });
  dom.canvasEmpty.hidden = visible.size !== 0;
  dom.visibleCount.textContent = String(visible.size);
  renderElementList(selection);
  if (runtime.selected?.type === "element" && !visible.has(runtime.selected.id)) selectOverview();
  if (fit) fitGraph();
}

function setLens(lens) {
  runtime.lens = lens;
  for (const button of dom.lensButtons) {
    const active = button.dataset.lens === lens;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  }
  updateView({ fit: true });
}

function activeTrailFrame() {
  runtime.trailFrame = null;
  if (!runtime.cy || window.matchMedia("(prefers-reduced-motion: reduce)").matches || document.hidden) return;
  runtime.trailOffset = (runtime.trailOffset - 1.4) % 30;
  runtime.cy.edges(".status-active").style("line-dash-offset", runtime.trailOffset);
  runtime.trailFrame = window.setTimeout(activeTrailFrame, 90);
}

function startTrailAnimation() {
  if (runtime.trailFrame !== null) window.clearTimeout(runtime.trailFrame);
  runtime.trailFrame = window.setTimeout(activeTrailFrame, 90);
}

function renderCounts(model) {
  const counts = [
    [model.summary.satisfied_nodes, `满足节点 / ${model.summary.nodes}`],
    [model.summary.verified_edges, `验证工作 / ${model.summary.edges}`],
    [model.summary.proof_gaps, "证明缺口"],
    [`${model.summary.acceptance_passed}/${model.summary.acceptance_total}`, "验收通过"],
  ];
  dom.mapCounts.replaceChildren(...counts.map(([value, label]) => {
    const card = element("div", "count-card");
    card.append(element("strong", "", value), element("span", "", label));
    return card;
  }));
}

function renderElementList(selection) {
  const matches = new Set(selection.matches);
  const nodes = runtime.model.nodes.filter((node) => selection.nodes.includes(node.id));
  const edges = runtime.model.edges.filter((edge) => selection.edges.includes(edge.id));
  const buttons = [];
  for (const node of nodes) {
    buttons.push(elementButton({
      id: node.id,
      name: node.label,
      meta: `${KIND_LABELS[node.kind] ?? node.kind} · ${statusLabel(node.status)}`,
      symbol: "○",
      matched: matches.has(node.id),
    }));
  }
  for (const edge of edges) {
    buttons.push(elementButton({
      id: edge.id,
      name: edge.title,
      meta: `工作边 · ${statusLabel(edge.status)}`,
      symbol: "→",
      matched: matches.has(edge.id),
    }));
  }
  if (!buttons.length) dom.elementList.replaceChildren(element("p", "empty-note", "当前镜头没有匹配对象。切换镜头或清除搜索可继续探索。"));
  else dom.elementList.replaceChildren(...buttons);
}

function elementButton({ id, name, meta, symbol, matched }) {
  const button = element("button", "element-button");
  button.type = "button";
  button.dataset.elementId = id;
  button.setAttribute("aria-label", `${name}，${meta}`);
  if (runtime.selected?.type === "element" && runtime.selected.id === id) button.classList.add("is-selected");
  if (matched) button.classList.add("is-match");
  const text = element("span");
  text.append(element("span", "element-name", name), element("span", "element-meta", meta));
  button.append(element("span", "element-symbol", symbol), text);
  button.addEventListener("click", () => selectMapElement(id, true));
  return button;
}

function selectMapElement(id, focusInspector = false) {
  const node = runtime.model?.nodes.find((item) => item.id === id);
  const edge = runtime.model?.edges.find((item) => item.id === id);
  if (!node && !edge) return;
  runtime.selected = { type: "element", id };
  runtime.cy?.elements().unselect();
  runtime.cy?.getElementById(id).select();
  renderElementList(selectElementIds(runtime.model, runtime.lens, runtime.query));
  if (node) renderNodeInspector(node);
  else renderEdgeInspector(edge);
  if (focusInspector && window.matchMedia("(max-width: 1180px)").matches) dom.inspector.focus({ preventScroll: false });
}

function selectOverview() {
  runtime.selected = { type: "overview" };
  runtime.cy?.elements().unselect();
  if (runtime.model) {
    renderElementList(selectElementIds(runtime.model, runtime.lens, runtime.query));
    renderOverview(runtime.model);
  }
}

function renderOverview(model) {
  const proof = model.proof;
  const content = [hero({
    eyebrow: "MAP OVERVIEW",
    title: model.map.destination.statement,
    id: model.map.id,
    chips: [
      makeChip(REACHABILITY_LABELS[proof.reachability] ?? proof.reachability, proof.reachability === "unreachable" ? "coral" : "amber"),
      makeChip(ARRIVAL_LABELS[model.map.actual_arrival] ?? model.map.actual_arrival, model.map.actual_arrival === "audited" ? "teal" : ""),
      makeChip("只读投影", "teal"),
    ],
  })];

  content.push(ledgerSection("正向可达性证明", [
    labeledValue("结构", STRUCTURAL_LABELS[proof.structural] ?? proof.structural),
    labeledValue("逻辑结论", REACHABILITY_LABELS[proof.reachability] ?? proof.reachability, proof.reachability === "unreachable" ? "bad" : "warn"),
    labeledValue("候选工作边", proof.candidate_edges),
    labeledValue("已证明工作边", proof.proven_edges),
    labeledValue("使用的假设", proof.assumptions_used),
  ]));
  content.push(ledgerSection("目的地验收", model.acceptance.map((acceptance) => labeledValue(
    `${acceptance.id} · ${acceptance.status === "passed" ? "通过" : "待验"}`,
    `${acceptance.proof}\n证明：${asText(acceptance.proves)}${acceptance.missing?.length ? `\n缺少：${asText(acceptance.missing)}` : ""}`,
    acceptance.status === "passed" ? "good" : "warn",
  ))));
  content.push(ledgerSection("全局证明缺口", model.proof_gaps.map((gap) => labeledValue(
    gap.type ?? "proof gap",
    asText(gap),
    "bad",
  )), "当前逻辑链没有发现证明缺口。"));
  content.push(ledgerSection("工作边界", [
    labeledValue("范围内", model.map.boundaries.in_scope),
    labeledValue("范围外", model.map.boundaries.out_of_scope),
    labeledValue("授权", model.map.boundaries.authorization),
    labeledValue("全程不变量", model.map.destination.invariants),
  ]));
  dom.inspectorContent.replaceChildren(...content);
}

function renderNodeInspector(node) {
  const incoming = runtime.model.edges.filter((edge) => edge.to === node.id);
  const outgoing = runtime.model.edges.filter((edge) => edge.from === node.id);
  const content = [hero({
    eyebrow: "STATE NODE",
    title: node.label,
    id: node.id,
    chips: [
      makeChip(KIND_LABELS[node.kind] ?? node.kind),
      makeChip(statusLabel(node.status), statusTone(node.status)),
    ],
  })];
  content.push(ledgerSection("状态断言", node.predicates.map((predicate) => labeledValue(
    predicate.id,
    `期望 ${predicate.equals} · 当前 ${predicate.actual}\nFact: ${predicate.fact}\n证据:\n${evidenceRefs(predicate.evidence)}`,
    predicate.satisfied ? "good" : ["unknown", "conflict"].includes(predicate.actual) ? "bad" : "warn",
  ))));
  content.push(ledgerSection("抵达这个状态的工作", incoming.map((edge) => labeledValue(
    edge.title,
    `${edge.id} · ${statusLabel(edge.status)}`,
    edge.status === "verified" ? "good" : edge.status === "active" ? "warn" : "",
  )), "这是起始状态，或尚未声明产生它的工作边。"));
  content.push(ledgerSection("从这里出发的工作", outgoing.map((edge) => labeledValue(
    edge.title,
    `${edge.id} · ${statusLabel(edge.status)}`,
    edge.status === "blocked" ? "bad" : edge.status === "active" ? "warn" : "",
  )), "这是路线终点，或尚未声明后续工作边。"));
  content.push(ledgerSection("关联证明缺口", node.proof_gaps.map((gap) => labeledValue(
    gap.type ?? "proof gap",
    asText(gap),
    "bad",
  )), "这个节点没有直接关联的证明缺口。"));
  dom.inspectorContent.replaceChildren(...content);
}

function renderEdgeInspector(edge) {
  const content = [hero({
    eyebrow: "WORK EDGE",
    title: edge.title,
    id: edge.id,
    chips: [
      makeChip(statusLabel(edge.status), statusTone(edge.status)),
      edge.proven ? makeChip("属于当前证明路线", "teal") : makeChip("不在当前剩余路线"),
      edge.candidate ? makeChip("当前候选", "amber") : makeChip(edge.status === "verified" ? "历史已完成" : "非当前候选"),
    ],
  })];
  content.push(ledgerSection("状态迁移", [
    labeledValue("从", edge.from),
    labeledValue("到", edge.to),
    labeledValue("执行准备", edge.ready ? "前置条件已满足" : `尚缺：${asText(edge.missing)}`, edge.ready ? "good" : "bad"),
    labeledValue("失败分支", edge.on_failure),
  ]));
  content.push(ledgerSection("前置条件", edge.preconditions.map((predicate) => labeledValue(
    predicate,
    `期望：${asText(predicateView(runtime.model, predicate)?.equals)} · 当前：${asText(predicateView(runtime.model, predicate)?.actual)}\nFact: ${asText(predicateView(runtime.model, predicate)?.fact)}`,
    predicateView(runtime.model, predicate)?.satisfied ? "good" : "warn",
  ))));
  content.push(ledgerSection("预期效果", edge.effects.map((predicate) => labeledValue(
    predicate,
    "只有执行并获得证据后，才会成为已观察事实。",
  ))));
  content.push(ledgerSection("不变量", edge.applicable_invariants.map((invariant) => labeledValue(
    invariant.id,
    `要求：${asText(invariant.requires)}\n适用：${asText(invariant.applies_to)}`,
  )), "没有额外声明的不变量。"));
  content.push(ledgerSection("证据合同", edge.evidence_contract.map((contract) => labeledValue(
    `${contract.id}${contract.required ? " · 必需" : ""}`,
    `证明：${asText(contract.proves)}`,
    contract.required ? "warn" : "",
  ))));
  content.push(ledgerSection("实施凭据", edge.evidence.map((record) => labeledValue(
    record.claim ?? record.recorded_at ?? "evidence",
    evidenceRecord(record),
    (record.limits?.unverified?.length ?? 0) === 0 ? "good" : "warn",
  )), "这条工作边尚无已登记实施凭据。"));
  content.push(ledgerSection("关联验收", edge.acceptance.map((acceptance) => labeledValue(
    `${acceptance.id} · ${acceptance.status === "passed" ? "通过" : "待验"}`,
    `${acceptance.proof}\n证明：${asText(acceptance.proves)}${acceptance.missing?.length ? `\n缺少：${asText(acceptance.missing)}` : ""}`,
    acceptance.status === "passed" ? "good" : "warn",
  )), "没有直接关联的目的地验收项。"));
  content.push(ledgerSection("证明缺口", edge.proof_gaps.map((gap) => labeledValue(
    gap.type ?? "proof gap",
    asText(gap),
    "bad",
  )), "这条工作边没有证明缺口。"));
  content.push(ledgerSection("循环约束", edge.loops.map((loop) => labeledValue(
    loop.id,
    `${loop.iterations}/${loop.max_iterations} 次${loop.exhausted ? " · 已耗尽" : ""}\n进展量：${asText(loop.progress_measure)}\n退出：${asText(loop.exit_condition)}`,
    loop.exhausted ? "bad" : "",
  )), "这条工作边不在循环中。"));

  const briefSection = element("section", "ledger-section");
  briefSection.append(element("h3", "", "Task Brief"));
  const briefReference = element("ul", "ledger-list");
  briefReference.append(labeledValue("引用", edge.brief.ref));
  briefSection.append(briefReference);
  if (edge.brief.metadata?.contract) {
    const metadata = element("pre", "brief-text", JSON.stringify(edge.brief.metadata.contract, null, 2));
    metadata.setAttribute("aria-label", "Task Brief 合同");
    briefSection.append(metadata);
  }
  if (edge.brief.content) {
    const raw = element("pre", "brief-text", edge.brief.content);
    raw.setAttribute("aria-label", "Task Brief 原文");
    briefSection.append(raw);
  } else {
    briefSection.append(element("p", "empty-note", "Brief 内容不可用；仅保留引用。"));
  }
  content.push(briefSection);
  dom.inspectorContent.replaceChildren(...content);
}

function renderTimeline(model) {
  if (!model.timeline.length) {
    dom.timeline.replaceChildren(element("p", "empty-note", "尚无运行历史或证据事件。看板不会把推演当作执行记录。"));
    return;
  }
  const events = [...model.timeline].reverse().slice(0, 30).map((entry) => {
    const eventName = EVENT_LABELS[entry.label] ?? entry.label;
    const eventContext = entry.edge ?? entry.details?.edge;
    const eventTitle = eventContext ? `${eventName} · ${eventContext}` : eventName;
    const button = element("button", `timeline-event${entry.kind === "evidence" ? " is-evidence" : ""}`);
    button.type = "button";
    button.append(element("strong", "", eventTitle), element("span", "", `${formatTimestamp(entry.at)} · ${entry.kind === "evidence" ? "凭据" : "状态"}`));
    button.addEventListener("click", () => {
      runtime.selected = { type: "timeline", id: entry.id };
      const content = [hero({
        eyebrow: "CHANGE SOUNDING",
        title: eventTitle,
        id: entry.id,
        chips: [makeChip(entry.kind === "evidence" ? "实施凭据" : "状态事件", entry.kind === "evidence" ? "teal" : "")],
      }), ledgerSection("事件记录", [labeledValue("时间", formatTimestamp(entry.at)), labeledValue("详情", entry.details)])];
      dom.inspectorContent.replaceChildren(...content);
      if (window.matchMedia("(max-width: 1180px)").matches) dom.inspector.focus({ preventScroll: false });
    });
    return button;
  });
  dom.timeline.replaceChildren(...events);
}

function formatTimestamp(value) {
  if (!value) return "未记录时间";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return asText(value);
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(date);
}

function updateSourceState(model) {
  const stale = model.projection.source_status !== "current";
  dom.syncState.classList.toggle("is-current", !stale);
  dom.syncState.classList.toggle("is-stale", stale);
  dom.syncState.textContent = stale ? "使用最近有效版本" : "已同步";
  dom.sourceBanner.hidden = !stale;
  dom.sourceBanner.textContent = stale
    ? `真相源暂不可用，当前保留最近一次有效地图：${model.projection.source_error ?? "来源状态异常"}`
    : "";
  dom.freshness.textContent = `投影 ${formatTimestamp(model.projection.generated_at)} · ${model.projection.mode === "runtime" ? "运行态" : "定义态"}`;
}

function renderModel(model) {
  const nextTopology = topologySignature(model);
  const topologyChanged = nextTopology !== runtime.topology;
  const previousSelection = runtime.selected;
  runtime.model = model;
  runtime.topology = nextTopology;

  dom.destination.textContent = model.map.destination.statement;
  document.title = `${model.map.id} · Mapflow Board`;
  dom.phase.textContent = PHASE_LABELS[model.map.phase] ?? model.map.phase;
  dom.reachability.textContent = REACHABILITY_LABELS[model.summary.reachability] ?? model.summary.reachability;
  dom.arrival.textContent = ARRIVAL_LABELS[model.map.actual_arrival] ?? model.map.actual_arrival;
  dom.revision.textContent = model.projection.revision.slice(0, 12);
  dom.revision.title = model.projection.revision;
  renderCounts(model);
  renderTimeline(model);
  updateSourceState(model);

  syncGraph(model, topologyChanged);
  updateView();
  if (topologyChanged) layoutGraph();

  if (previousSelection?.type === "element" && (
    model.nodes.some((item) => item.id === previousSelection.id) || model.edges.some((item) => item.id === previousSelection.id)
  )) selectMapElement(previousSelection.id);
  else if (previousSelection?.type === "timeline") {
    const timelineEntry = model.timeline.find((item) => item.id === previousSelection.id);
    if (!timelineEntry) selectOverview();
  } else selectOverview();
}

function showFetchError(message) {
  dom.syncState.classList.remove("is-current");
  dom.syncState.classList.add("is-stale");
  dom.syncState.textContent = runtime.model ? "连接中断" : "无法连接";
  dom.sourceBanner.hidden = false;
  dom.sourceBanner.textContent = runtime.model
    ? `暂时无法刷新真相源，继续展示最近一次有效地图：${message}`
    : `无法读取地图：${message}`;
  if (!runtime.model) {
    dom.inspectorContent.replaceChildren(element("p", "empty-note", "确认本地 Mapflow board 服务仍在运行，然后刷新页面。"));
  }
}

async function pollBoard() {
  if (runtime.pollTimer !== null) window.clearTimeout(runtime.pollTimer);
  if (document.hidden) {
    runtime.pollTimer = window.setTimeout(pollBoard, POLL_INTERVAL_MS);
    return;
  }
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const headers = runtime.etag ? { "If-None-Match": runtime.etag } : {};
    const response = await fetch("/api/board", { headers, cache: "no-store", signal: controller.signal });
    if (response.status === 304) {
      if (runtime.model) updateSourceState(runtime.model);
    } else {
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`);
      runtime.etag = response.headers.get("ETag");
      renderModel(body);
      dom.announcer.textContent = `地图已刷新，版本 ${body.projection.revision.slice(0, 8)}`;
    }
  } catch (error) {
    showFetchError(error.name === "AbortError" ? "读取超时" : error.message);
  } finally {
    window.clearTimeout(timeout);
    runtime.pollTimer = window.setTimeout(pollBoard, POLL_INTERVAL_MS);
  }
}

function bindControls() {
  dom.lensButtons.forEach((button) => button.addEventListener("click", () => setLens(button.dataset.lens)));
  dom.search.addEventListener("input", () => {
    runtime.query = dom.search.value;
    updateView();
  });
  dom.fit.addEventListener("click", fitGraph);
  dom.relayout.addEventListener("click", layoutGraph);
  document.addEventListener("keydown", (event) => {
    if (event.key === "/" && !event.ctrlKey && !event.metaKey && !event.altKey && !["INPUT", "TEXTAREA"].includes(document.activeElement?.tagName)) {
      event.preventDefault();
      dom.search.focus();
    }
    if (event.key === "Escape" && document.activeElement === dom.search && dom.search.value) {
      dom.search.value = "";
      runtime.query = "";
      updateView({ fit: true });
    }
  });
  document.addEventListener("visibilitychange", () => {
    startTrailAnimation();
    if (!document.hidden) pollBoard();
  });
  window.matchMedia("(prefers-reduced-motion: reduce)").addEventListener?.("change", startTrailAnimation);
}

function bootstrap() {
  bindControls();
  dom.inspectorContent.replaceChildren(element("p", "empty-note", "正在读取 Blueprint、运行状态和实施凭据…"));
  pollBoard();
}

if (typeof document !== "undefined") bootstrap();
