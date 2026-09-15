const POLL_INTERVAL_MS = 15000;
const REQUEST_TIMEOUT_MS = 5000;
const ACTION_RECEIPT_KEY = "mapflow.workspace-action-receipt/v1";

const STATUS_LABELS = {
  active: "实施中",
  arrived: "已到达",
  blocked: "阻塞",
  cancelled: "已取消",
  candidate: "候选",
  confirmed: "已确认待登记",
  conflict: "冲突",
  current: "当前有效",
  declined: "已拒绝",
  draft: "草拟中",
  "destination-fog": "目的地迷雾",
  fog: "迷雾",
  failed: "失败",
  established: "已建立",
  "not-observed": "尚未观察",
  "not-started": "尚未开始",
  granted: "已批准",
  answered: "已回答",
  deferred: "已延期",
  pending: "待确认",
  pinned: "历史固定",
  historical: "历史快照",
  rejected: "已拒绝",
  ready: "前置已满足",
  shaped: "已定形",
  satisfied: "已满足",
  unsatisfied: "未满足",
  verified: "已验证",
  waiting: "等待中",
  stale: "已失效",
  drifted: "当前已漂移",
  "historical-arrival": "历史 Arrival",
  unobserved: "未记录",
  audited: "已审计到达",
  missing: "缺失",
};

const KIND_LABELS = {
  destination: "目的地",
  fog: "迷雾节点",
  join: "汇合状态",
  state: "状态节点",
  decision: "决策节点",
  submap: "子地图地形",
};

const TARGET_KIND_LABELS = {
  destination: "目的地",
  edge: "工作边",
  node: "节点",
  predicate: "条件",
};

const REACHABILITY_LABELS = {
  "not-started": "未开始",
  conditional: "条件可达",
  logical: "逻辑可达",
  unreachable: "不可达",
};

const ARRIVAL_LABELS = {
  audited: "已审计到达",
  "not-audited": "尚未实际到达",
};

const REGRESSION_LABELS = {
  connected: "事实前缀已接通",
  "model-only": "仅模型可达",
  "awaiting-prefix": "等待起点前缀",
  "suffix-unproven": "目标后缀未证明",
  observed: "已观察",
  logical: "逻辑可达",
  conditional: "条件可达",
  unreachable: "不可达",
  fog: "迷雾",
};

const PHASE_LABELS = {
  arrived: "到达审计完成",
  implementation: "路线实施",
  replan: "局部修图",
  wayfinding: "探路建模",
};

const WAYFINDING_PHASE_LABELS = {
  survey: "了解现状",
  shaping: "确认目标",
  regression: "倒推路线",
};

const STRUCTURAL_LABELS = {
  "not-started": "尚未建立",
  complete: "结构完整",
  incomplete: "结构不完整",
};

const EVIDENCE_LEVEL_LABELS = {
  structural_soundness: "结构可靠",
  declared_model_derivability: "声明模型可推导",
  runtime_readiness: "运行时就绪",
  executed_derivation: "已执行推导",
  audited_arrival: "已审计抵达",
};

const EVENT_LABELS = {
  arrival_audit_requested: "等待人工到达审计",
  arrival_audited: "到达审计完成",
  edge_selected: "工作边已选中",
  edge_verification_incomplete: "工作边验收未完成",
  edge_run_waiting: "工作边进入等待",
  edge_run_blocked: "工作边被阻塞",
  edge_run_resumed: "工作边已恢复",
  edge_run_cancelled: "工作边已取消",
  edge_failed_replan: "工作边失败并返回修图",
  edge_failed_branch_started: "工作边失败并启动备用路线",
  edge_failed_branch_blocked: "工作边失败且备用路线阻塞",
  edge_failed_stop: "工作边失败并停止",
  edge_verification_blocked: "工作边验收受未验证项阻塞",
  edge_verified: "工作边已验证",
  initialized: "运行地图已建立",
  reachability_proved: "正向可达性已证明",
  replan_requested: "地图已重新登记",
  replanned: "地图已局部修订",
  proposal_created: "Proposal 已创建",
  proposal_confirmed: "Proposal 已确认",
  proposal_rejected: "Proposal 已拒绝",
  proposal_stale: "Proposal 已过期",
  decision_recorded: "路线决策已记录",
  implementation_entered: "开始沿地图推进",
  edge_authorization_requested: "施工授权已请求",
  edge_authorized: "施工授权已确认",
  edge_authorization_declined: "施工授权已拒绝",
  decision_owner_assigned: "人工门责任人已登记",
  submap_receipt_accepted: "子地图回执已接纳",
  successor_started: "开始后继航段",
};

const dom = typeof document === "undefined" ? {} : {
  announcer: document.querySelector("#announcer"),
  actionAfter: document.querySelector("#current-action-after"),
  actionGate: document.querySelector("#current-action"),
  actionOwner: document.querySelector("#current-action-owner"),
  actionQuestion: document.querySelector("#current-action-question"),
  actionState: document.querySelector("#current-action-state"),
  actionTitle: document.querySelector("#current-action-title"),
  adjustDestination: document.querySelector("#adjust-destination"),
  adjustment: document.querySelector("#wayfinding-adjustment"),
  adjustmentCancel: document.querySelector("#cancel-adjustment"),
  adjustmentForm: document.querySelector("#wayfinding-adjust-form"),
  confirmDestination: document.querySelector("#confirm-destination"),
  currentPosition: document.querySelector("#current-position"),
  currentPositionDetail: document.querySelector("#current-position-detail"),
  currentPositionTitle: document.querySelector("#current-position-title"),
  arrival: document.querySelector("#arrival-value"),
  canvasEmpty: document.querySelector("#canvas-empty"),
  cy: document.querySelector("#cy"),
  destination: document.querySelector("#destination-title"),
  destinationContext: document.querySelector("#destination-context"),
  elementList: document.querySelector("#element-list"),
  evolutionCounter: document.querySelector("#evolution-counter"),
  evolutionBreadcrumb: document.querySelector("#evolution-breadcrumb"),
  evolutionCoverage: document.querySelector("#evolution-coverage"),
  evolutionDiff: document.querySelector("#evolution-diff"),
  evolutionFirst: document.querySelector("#evolution-first"),
  evolutionLive: document.querySelector("#evolution-live"),
  evolutionMeta: document.querySelector("#evolution-meta"),
  evolutionMode: document.querySelector("#evolution-mode"),
  evolutionNext: document.querySelector("#evolution-next"),
  evolutionPlay: document.querySelector("#evolution-play"),
  evolutionPlayer: document.querySelector("#evolution-player"),
  evolutionPrevious: document.querySelector("#evolution-previous"),
  evolutionParent: document.querySelector("#evolution-parent"),
  evolutionSlider: document.querySelector("#evolution-slider"),
  evolutionSpeed: document.querySelector("#evolution-speed"),
  evolutionSummary: document.querySelector("#evolution-summary"),
  fit: document.querySelector("#fit-map"),
  freshness: document.querySelector("#freshness"),
  goalCriteria: document.querySelector("#goal-criteria"),
  goalOutOfScope: document.querySelector("#goal-out-of-scope"),
  goalSummary: document.querySelector("#goal-summary"),
  goalSummaryStatus: document.querySelector("#goal-summary-status"),
  inspector: document.querySelector("#inspector"),
  inspectorContent: document.querySelector("#inspector-content"),
  inspectorToggle: document.querySelector("#toggle-inspector"),
  journeyDestination: document.querySelector("#journey-destination"),
  journeyOrigin: document.querySelector("#journey-origin"),
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
  workbench: document.querySelector("#workbench"),
  wayfindingRail: document.querySelector("#wayfinding-rail"),
  wayfindingResponse: document.querySelector("#wayfinding-response"),
  wayfindingResponseActions: document.querySelector("#wayfinding-response > .response-actions"),
  wayfindingResponseStatus: document.querySelector("#wayfinding-response-status"),
  canvasExplanation: document.querySelector("#canvas-explanation"),
  canvasEyebrow: document.querySelector("#canvas-eyebrow"),
};

const runtime = {
  actionBusy: false,
  actionQuestionId: null,
  actionReceipt: (() => {
    if (typeof sessionStorage === "undefined") return null;
    try {
      return JSON.parse(sessionStorage.getItem(ACTION_RECEIPT_KEY) ?? "null");
    } catch {
      return null;
    }
  })(),
  cy: null,
  etag: null,
  liveModel: null,
  rootModel: null,
  childModels: new Map(),
  submapEtags: new Map(),
  expandedSubmaps: new Set(),
  lens: "all",
  layoutCount: 0,
  model: null,
  pollTimer: null,
  stream: null,
  query: "",
  selected: null,
  topology: null,
  trailFrame: null,
  trailOffset: 0,
  positionLedger: new Map(),
  evolution: {
    bindingPath: null,
    catalog: null,
    etag: null,
    frame: null,
    index: null,
    pendingLive: false,
    playing: false,
    stack: [],
    timer: null,
  },
};

function asText(value) {
  if (value === null || value === undefined || value === "") return "—";
  if (Array.isArray(value)) return value.length ? value.map(asText).join(" · ") : "无";
  if (typeof value === "object") return JSON.stringify(value, null, 2);
  return String(value);
}

function questionUpdateLabel(question) {
  const updates = question.answer_updates?.length ? asText(question.answer_updates) : "无";
  return `回答后处理：${updates}；回答不会自动确认节点、边或 Fact`;
}

function humanQuestionText(question) {
  if (question?.target?.kind === "destination") {
    return "这份目标、完成标准和“暂时不做”的范围，符合你对第一版的预期吗？";
  }
  return question?.prompt ?? "请补充当前情况。";
}

function humanSurfaceText(value) {
  return String(value ?? "")
    .replace(/\bGit worktree\b/gi, "项目")
    .replace(/\bOwner\b/g, "你")
    .replace(/\bBlueprint\b/g, "路线图")
    .replace(/\bPredicate\b/g, "完成条件")
    .replace(/\bFact\b/g, "已知事实")
    .replace(/\bDestination\b/g, "目标")
    .replace(/\bMVP\b/gi, "第一版");
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
    const strength = record.strength ? ` · ${record.strength}` : "";
    return `${record.kind ?? "evidence"}: ${record.ref ?? asText(record)}${strength}${observedAt}`;
  }).join("\n");
}

function evidenceRecord(record) {
  const checks = (record.checks ?? []).map((check) => (
    `${check.mode ?? "legacy"} · ${check.result ?? "unknown"}: ${check.command ?? "未记录检查"} → ${check.observed ?? "未记录观察"}${Number.isInteger(check.exit_code) ? ` · exit ${check.exit_code}` : ""}`
  ));
  const limitations = Object.entries(record.limits ?? {})
    .filter(([, values]) => values?.length)
    .map(([kind, values]) => `${kind}: ${values.join(" · ")}`);
  return [
    `执行者：${record.executor ?? "未记录"}`,
    `可信度：${record.trust === "verified" ? "Runtime 已验证" : record.trust === "reported" ? "调用方自报，不改变事实" : "历史/回读证据"}`,
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

function ledgerDisclosure(title, sections, meta = "") {
  const details = element("details", "ledger-disclosure");
  const summary = element("summary");
  summary.append(element("span", "", title));
  if (meta) summary.append(element("span", "mono", meta));
  details.append(summary, ...sections);
  return details;
}

function statusLabel(value) {
  return STATUS_LABELS[value] ?? asText(value);
}

function decisionOwnerLabel(request) {
  if (request?.decision_owner === "human:owner") return "你（human:owner）";
  if (request?.decision_owner) return request.decision_owner;
  return "人工任务所有者（具体身份未登记）";
}

function pendingHumanRequests(model) {
  return [
    ...(model.arrival_audit_requests ?? []).filter((request) => request.status === "pending").map((request) => ({ request, kind: "到达审计" })),
    ...(model.authorization_requests ?? []).filter((request) => request.status === "pending").map((request) => ({ request, kind: "施工授权" })),
  ];
}

function requiresEdgeAuthorization(edge) {
  return (edge.brief?.metadata?.contract?.authorization?.required ?? []).length > 0;
}

export function edgeExecutionLabel(edge, model) {
  if (edge.status !== "ready") return statusLabel(edge.status);
  if (model.projection?.mode === "definition") return "前置已满足，仅为定义态";
  const pendingAuthorization = (edge.authorization_requests ?? []).find((request) => request.status === "pending");
  if (pendingAuthorization) return "前置已满足，待授权确认";
  return requiresEdgeAuthorization(edge) ? "前置已满足，需请求声明授权" : "前置已满足，可直接启动";
}

export function timelineEventLabel(entry) {
  if (entry.label === "destination_approved" && (!entry.details?.approval || !entry.details?.request)) {
    return "旧版目的地批准与首边选择";
  }
  return EVENT_LABELS[entry.label] ?? entry.label;
}

export function currentActionView(model) {
  const result = (value) => ({ requested_by: null, target_id: null, ...value });
  if (model.projection?.mode === "empty") {
    return result({
      state: "agent-next",
      state_label: "先建立起点",
      title: "确认当前起点",
      owner: "当前会话 Agent",
      question: "从权威来源确认现在已经具备什么，记录为事实后再开始规划。",
      after: "有来源的起点建立后，地图才会给出目的地和下一步。",
    });
  }
  if (model.projection?.mode === "wayfinding") {
    const question = (model.questions ?? []).find((item) => (
      item.id === model.wayfinding?.current_question_id && item.status === "pending"
    )) ?? (model.questions ?? []).find((item) => item.status === "pending");
    if (question) {
      const isDestinationChoice = question.target?.kind === "destination";
      return result({
        state: "waiting-human",
        state_label: isDestinationChoice ? "需要你决定" : "需要补充信息",
        title: isDestinationChoice ? "确认第一版做到什么程度" : "补充当前情况",
        owner: isDestinationChoice ? "你" : decisionOwnerLabel(question),
        requested_by: question.requested_by ?? null,
        target_id: question.target?.id ?? question.id,
        question: humanQuestionText(question),
        after: isDestinationChoice
          ? "确认后开始从结果倒推路线；调整后先更新目标，再请你重新确认。"
          : "信息记录后，页面会给出下一项需要确认的内容。",
      });
    }
    const lastDestinationAnswer = [...(model.questions ?? [])].reverse().find((item) => (
      item.target?.kind === "destination" && item.status === "answered"
    ));
    if (lastDestinationAnswer) {
      const confirmed = /(?:确认|批准|同意|接受|就按这个)/.test(lastDestinationAnswer.answer ?? "")
        && !/(?:不确认|拒绝|调整|修改)/.test(lastDestinationAnswer.answer ?? "");
      return result({
        state: "agent-next",
        state_label: confirmed ? "目标已确认" : "调整意见已记录",
        title: confirmed ? "准备从结果倒推路线" : "正在更新目标",
        owner: "当前会话 Agent",
        question: confirmed ? "确认记录已经保存，接下来会生成一条能解释的完整路线。" : "修改内容已经保存，目标更新后会再次请你确认。",
        after: confirmed ? "路线生成后，你会先看到完整路线，再决定从哪里开始。" : "新目标不会自动确认。",
      });
    }
    return result({
      state: "agent-next",
      state_label: "正在整理",
      title: "准备下一步",
      owner: "当前会话 Agent",
      question: model.empty_state?.next_steps?.[0] ?? wayfindingNextAction(model.wayfinding?.phase),
      after: model.empty_state?.next_steps?.[1] ?? "整理完成后，页面只会给出一个明确的下一步。",
    });
  }

  const ownerless = pendingHumanRequests(model).find(({ request }) => !request.decision_owner);
  if (ownerless) {
    return result({
      state: "agent-next",
      state_label: "需要补责任人",
      title: `补登${ownerless.kind}责任人`,
      owner: "当前会话 Agent",
      target_id: ownerless.request.id,
      question: `为待处理请求 ${ownerless.request.id} 登记一名可识别的人类责任人。`,
      after: "恢复原人工门；只更新责任归属，不授权施工，也不登记到达。",
    });
  }

  const pendingArrival = (model.arrival_audit_requests ?? []).find((request) => request.status === "pending");
  if (pendingArrival) {
    return result({
      state: "waiting-human",
      state_label: "等待到达确认",
      title: "审计实际到达",
      owner: decisionOwnerLabel(pendingArrival),
      requested_by: pendingArrival.requested_by,
      target_id: pendingArrival.id,
      question: pendingArrival.question,
      after: "只登记到达审计；通过后实际到达才会显示为“已审计到达”。",
    });
  }
  const pendingAuthorization = (model.authorization_requests ?? []).find((request) => request.status === "pending");
  if (pendingAuthorization) {
    const edge = model.edges?.find((item) => item.id === pendingAuthorization.edge);
      return result({
        state: "waiting-human",
      state_label: "等待授权",
      title: `确认可以开始：${edge?.title ?? pendingAuthorization.edge}`,
      owner: decisionOwnerLabel(pendingAuthorization),
      requested_by: pendingAuthorization.requested_by,
      target_id: pendingAuthorization.edge,
      question: pendingAuthorization.question,
      after: "确认后只会开放这一项任务；其他任务保持原状态。",
    });
  }
  const pendingProposal = (model.proposals ?? []).find((proposal) => proposal.status === "pending");
  if (pendingProposal) {
      return result({
        state: "waiting-human",
      state_label: "等待确认",
      title: `确认事实：${pendingProposal.fact}`,
      owner: decisionOwnerLabel(pendingProposal),
      target_id: pendingProposal.id,
      question: `是否确认 ${pendingProposal.fact} = ${pendingProposal.value}？`,
      after: "确认后才更新实际 Fact 并重新派生满足节点；拒绝不会改变 Fact。",
    });
  }
  if (model.map?.actual_arrival === "audited") {
    const drifted = model.map.current_destination?.status === "drifted";
    return result({
      state: drifted ? "agent-next" : "complete",
      state_label: drifted ? "事实已漂移" : "本航段已完成",
      title: drifted ? "曾经到达，但当前事实已经变化" : "本航段已完成到达审计",
      owner: drifted ? "当前会话 Agent 与任务所有者" : "任务所有者",
      question: drifted ? `重新核验：${asText(model.map.current_destination.missing)}` : "是否开始一个已确认的新 Destination？",
      after: "历史 Arrival 保持不变；用 continue 将新 Destination 绑定为后继航段。",
    });
  }
  const activeEdge = model.edges?.find((edge) => edge.id === model.summary?.active_edge);
  if (activeEdge) {
      return result({
        state: "in-progress",
        state_label: "工作进行中",
        title: `继续：${activeEdge.title}`,
      owner: activeEdge.latestRun?.executor ?? "当前工作边执行者",
      target_id: activeEdge.id,
        question: "按这项任务的约定继续工作，并提交可以核验的完成证据。",
        after: "证据到达后，地图会重新判断下一项任务和目的地状态。",
    });
  }
  if (model.projection?.mode === "definition") {
    return result({
      state: "agent-next",
      state_label: "准备地图",
      title: "登记这张路线图",
      owner: "当前会话 Agent",
      question: "这张图还没有进入运行；登记后才能沿任务推进并接收事实变化。",
      after: "登记后，地图会从当前事实中找出可开始的任务。",
    });
  }
  const readyEdges = model.edges?.filter((edge) => edge.status === "ready" && edge.proven) ?? [];
  if (readyEdges.length > 1) {
    const parallelCount = model.summary?.parallel_ready_edges ?? 0;
    return result({
      state: "agent-next",
      state_label: parallelCount > 1 ? "并行分支已就绪" : "需要选择路线",
      title: parallelCount > 1 ? `${parallelCount} 项任务可以并行推进` : `${readyEdges.length} 项任务等待选择`,
      owner: "当前会话 Agent 与任务所有者",
      target_id: readyEdges.map((edge) => edge.id).join(","),
      question: `选择要先推进的任务：${readyEdges.map((edge) => edge.title).join("；")}`,
      after: "选中的任务开始后，其他独立任务仍保持可开始。",
    });
  }
  const readyEdge = readyEdges[0];
  if (readyEdge) {
    const protectedEdge = requiresEdgeAuthorization(readyEdge);
    return result({
      state: "agent-next",
      state_label: protectedEdge ? "需要授权" : "可以开始",
      title: protectedEdge ? `等待授权：${readyEdge.title}` : `开始：${readyEdge.title}`,
      owner: "当前会话 Agent",
      target_id: readyEdge.id,
      question: protectedEdge ? "这项任务需要责任人确认后才能开始。" : "前置条件已满足，可以开始这项任务。",
      after: protectedEdge ? "责任人确认后，这项任务才会进入进行中。" : "完成后提交可核验的证据，地图会据此刷新。",
    });
  }
  const destinationObserved = (model.map?.destination?.requires ?? []).every((predicateId) => (
    model.predicates?.some((predicate) => predicate.id === predicateId && predicate.satisfied)
  ));
  const acceptanceObserved = (model.acceptance?.length ?? 0) > 0
    && model.acceptance.every((item) => item.status === "passed");
  if (destinationObserved && acceptanceObserved) {
    return result({
      state: "agent-next",
      state_label: "准备确认到达",
      title: "请求到达审计",
      owner: "当前会话 Agent",
      question: "成果看起来已满足目的地；请交给责任人确认是否真的到达。",
      after: "确认后会留下不可改写的到达记录，并允许开始下一航段。",
    });
  }
  return result({
    state: "agent-next",
    state_label: model.proof?.reachability === "unreachable" ? "需要修图" : "等待事实刷新",
    title: model.proof?.reachability === "unreachable" ? "补齐路线缺口" : "重新判断下一步",
    owner: "当前会话 Agent",
    question: model.proof?.reachability === "unreachable" ? "定位离目的地最近、但还没有被事实接通的缺口。" : "当前没有新的事实或人工决定可以推进路线。",
    after: model.proof?.reachability === "unreachable" ? "只修订受影响的局部路线，再重新判断可达性。" : "事实变化后，地图会重新计算可推进任务。",
  });
}

export function wayfindingInteractionView(model) {
  if (model.evolution?.historical || model.interaction?.mode !== "destination-answer") {
    return { enabled: false };
  }
  const question = (model.questions ?? []).find((item) => (
    item.id === model.interaction.question_id
    && item.id === model.wayfinding?.current_question_id
    && item.status === "pending"
    && item.target?.kind === "destination"
  ));
  if (!question || model.interaction.revision !== model.projection?.revision) return { enabled: false };
  return {
    enabled: true,
    endpoint: model.interaction.endpoint,
    token: model.interaction.token,
    revision: model.interaction.revision,
    question_id: question.id,
  };
}

export function interactionReceiptView(receipt, model) {
  if (!receipt || !model?.projection?.revision) return null;
  const workspaceId = model.projection.workspace_head?.workspace_id ?? null;
  if (receipt.workspace_id && workspaceId && receipt.workspace_id !== workspaceId) return null;
  const applied = model.projection.revision !== receipt.recorded_revision;
  return {
    ...receipt,
    status: applied ? "applied" : "recorded",
    message: applied ? "已应用到地图" : "已记录，等待 Codex 处理",
  };
}

function persistActionReceipt(receipt) {
  runtime.actionReceipt = receipt;
  if (typeof sessionStorage === "undefined") return;
  try {
    if (receipt) sessionStorage.setItem(ACTION_RECEIPT_KEY, JSON.stringify(receipt));
    else sessionStorage.removeItem(ACTION_RECEIPT_KEY);
  } catch {
    // The in-memory receipt still keeps the current page honest when storage is unavailable.
  }
}

export function navigationPositionView(model) {
  if (model.projection?.mode === "empty") {
    return { label: "尚未建立地图", detail: "先勘探有来源的起始事实", state: "fog" };
  }
  if (model.projection?.mode === "wayfinding") {
    const target = model.wayfinding?.current_target;
    const phase = model.wayfinding?.phase ?? model.map.wayfinding_phase;
    if (phase === "survey") return {
      label: "正在了解现状",
      detail: "先确认已经具备什么、还缺什么",
      state: target ? "active" : "waiting",
    };
    if (phase === "shaping") return {
      label: "正在确认第一版范围",
      detail: "目标确认后，才会从结果倒推出路线",
      state: target ? "active" : "waiting",
    };
    if (phase === "regression") return {
      label: "正在从结果倒推路线",
      detail: "路线形成后会先整体展示，再开始行动",
      state: target ? "active" : "waiting",
    };
    return {
      label: target?.label ?? wayfindingPhaseTitle(model),
      detail: "正在整理可执行路线",
      state: target ? "active" : "waiting",
    };
  }

  const destinationNode = model.nodes?.find((node) => node.id === model.map?.current_destination?.node_id)
    ?? model.nodes?.find((node) => node.kind === "destination");
  if (model.map?.actual_arrival === "audited") {
    return {
      label: destinationNode?.label ?? model.map?.destination?.statement ?? "本航段目的地",
      detail: "本航段已审计到达，可从这里开始下一航段",
      state: "complete",
    };
  }

  const activeEdge = model.edges?.find((edge) => edge.id === model.summary?.active_edge);
  if (activeEdge) {
    const source = model.nodes?.find((node) => node.id === activeEdge.from)?.label ?? activeEdge.from;
    const target = model.nodes?.find((node) => node.id === activeEdge.to)?.label ?? activeEdge.to;
    return { label: activeEdge.title, detail: `${source} -> ${target}`, state: "active" };
  }

  if ((model.arrival_audit_requests ?? []).some((request) => request.status === "pending")) {
    return {
      label: destinationNode?.label ?? model.map?.destination?.statement ?? "本航段目的地",
      detail: "工作已完成，等待到达审计",
      state: "waiting",
    };
  }

  const readyEdges = model.edges?.filter((edge) => edge.status === "ready" && edge.proven) ?? [];
  if (readyEdges.length) {
    const sourceIds = [...new Set(readyEdges.map((edge) => edge.from))];
    const sourceLabels = sourceIds.map((id) => model.nodes?.find((node) => node.id === id)?.label ?? id);
    return {
      label: sourceLabels.length === 1 ? sourceLabels[0] : `${sourceLabels.length} 个可推进起点`,
      detail: `${readyEdges.length} 项任务已满足前置条件`,
      state: "ready",
    };
  }

  if (destinationNode?.satisfied) {
    return {
      label: destinationNode.label,
      detail: "目的地事实已满足，等待下一道可信门",
      state: "waiting",
    };
  }

  const frontier = model.nodes?.find((node) => node.satisfied && model.edges?.some((edge) => edge.from === node.id && edge.status !== "verified"));
  return {
    label: frontier?.label ?? "路线暂未接通",
    detail: model.proof?.reachability === "unreachable" ? "需要从最近的证明缺口局部修图" : "等待事实刷新后重新计算路线",
    state: model.proof?.reachability === "unreachable" ? "blocked" : "waiting",
  };
}

function statusTone(value) {
  if (["arrived", "historical-arrival", "satisfied", "verified", "passed"].includes(value)) return "teal";
  if (["active", "candidate", "ready"].includes(value)) return "amber";
  if (["fog", "destination-fog"].includes(value)) return "violet";
  if (["blocked", "conflict", "drifted", "failed", "stale"].includes(value)) return "coral";
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
    node.purpose,
    node.status,
    node.goal_regression?.bridge_status,
    node.goal_regression?.prefix_reachability?.status,
    node.goal_regression?.suffix_proof?.status,
    node.predicates?.flatMap((predicate) => [predicate.id, predicate.fact, predicate.kind, predicate.actual]),
  ], query);
}

function edgeMatches(edge, query) {
  return includesQuery([
    edge.id,
    edge.title,
    edge.purpose,
    edge.status,
    edge.from,
    edge.to,
    edge.preconditions,
    edge.effects,
    edge.invariants,
    edge.brief_ref,
    edge.goal_regression?.map((item) => [item.bridge_status, item.prefix_reachability?.status, item.suffix_proof?.status]),
  ], query);
}

function fogOrGapEdge(edge, model) {
  if (edge.proof_gaps?.length) return true;
  return edge.missing?.some((missing) => {
    const value = predicateView(model, missing.predicate)?.actual;
    return value === "unknown" || value === "conflict";
  }) ?? false;
}

function submapContainerId(bindingPath) {
  return `submap::${bindingPath.replaceAll("/", "::")}`;
}

export function collapsedSubmapElements(binding, parentEdge, bindingPath, parentContainerId = null) {
  const token = bindingPath.replaceAll("/", "::");
  const containerId = submapContainerId(bindingPath);
  const status = binding.source_status === "stale" || binding.receipt_status === "stale"
    ? "stale"
    : binding.actual_arrival === "audited"
      ? "arrived"
      : "unsatisfied";
  const historyHint = binding.source_status === "historical"
    ? binding.historical_frame ? "双击回放固定帧" : "双击查看独立历史"
    : "双击展开";
  const node = {
    id: containerId,
    original_id: binding.id,
    kind: "submap",
    label: `${parentEdge.title ?? binding.map_id}\n子地图 · ${binding.actual_arrival === "audited" ? `已审计 ${binding.acceptance_passed ?? 0}/${binding.acceptance_total ?? 0}` : "尚未到达"}\n${historyHint}`,
    status,
    predicates: [],
    proof_gaps: [],
    satisfied: status === "arrived",
    projection_only: true,
    collapsed: true,
    submap: { ...binding, path: bindingPath },
    ...(parentContainerId ? { parent: parentContainerId } : {}),
  };
  const portal = (id, title, from, to) => ({
    id: `portal::${token}::${id}`,
    title,
    from,
    to,
    status: binding.source_status === "stale" ? "stale" : "verified",
    candidate: true,
    proven: binding.source_status !== "stale",
    ready: binding.source_status !== "stale",
    missing: [],
    preconditions: [],
    effects: [],
    invariants: [],
    applicable_invariants: [],
    evidence_contract: [],
    evidence: [],
    acceptance: [],
    proof_gaps: [],
    loops: [],
    brief: { ref: "projection-only", metadata: null, content: null },
    on_failure: { action: "none" },
    projection_only: true,
  });
  return {
    node,
    edges: [
      portal("collapsed-entry", "进入子地图", parentEdge.from, containerId),
      portal("collapsed-exit", "子地图结果", containerId, parentEdge.to),
    ],
  };
}

function namespacedChildModel(binding, model, bindingPath, parentEdge, parentContainerId = null) {
  const prefix = `${bindingPath.replaceAll("/", "::")}::`;
  const containerId = submapContainerId(bindingPath);
  const predicateId = (id) => `${prefix}${id}`;
  const regressionStep = (step) => step ? {
    ...step,
    target_node: `${prefix}${step.target_node}`,
    suffix_proof: {
      ...step.suffix_proof,
      target_node: `${prefix}${step.suffix_proof?.target_node ?? step.target_node}`,
      proven_edges: (step.suffix_proof?.proven_edges ?? []).map((id) => `${prefix}${id}`),
      seeded_predicates: (step.suffix_proof?.seeded_predicates ?? []).map(predicateId),
    },
    required_predicates: (step.required_predicates ?? []).map(predicateId),
    incoming_edges: (step.incoming_edges ?? []).map((edge) => ({
      ...edge,
      edge_id: `${prefix}${edge.edge_id}`,
      from: `${prefix}${edge.from}`,
      to: `${prefix}${edge.to}`,
      required_predicates: (edge.required_predicates ?? []).map(predicateId),
      effects: (edge.effects ?? []).map(predicateId),
      suffix_proven: edge.suffix_proven,
    })),
  } : null;
  const predicates = model.predicates.map((predicate) => ({
    ...predicate,
    id: predicateId(predicate.id),
    fact: predicateId(predicate.fact),
    map_id: model.map.id,
  }));
  const nodes = model.nodes.map((node) => ({
    ...node,
    id: `${prefix}${node.id}`,
    original_id: node.id,
    parent: containerId,
    map_id: model.map.id,
    predicates: node.predicates.map((predicate) => ({
      ...predicate,
      id: predicateId(predicate.id),
      fact: predicateId(predicate.fact),
    })),
    goal_regression: regressionStep(node.goal_regression),
  }));
  const edges = model.edges.map((edge) => ({
    ...edge,
    id: `${prefix}${edge.id}`,
    original_id: edge.id,
    from: `${prefix}${edge.from}`,
    to: `${prefix}${edge.to}`,
    map_id: model.map.id,
    preconditions: edge.preconditions.map(predicateId),
    effects: edge.effects.map(predicateId),
    missing: (edge.missing ?? []).map((item) => ({ ...item, predicate: predicateId(item.predicate) })),
    goal_regression: (edge.goal_regression ?? []).map((regression) => ({
      ...regression,
      target_node: `${prefix}${regression.target_node}`,
      suffix_proof: {
        ...regression.suffix_proof,
        target_node: `${prefix}${regression.suffix_proof?.target_node ?? regression.target_node}`,
        proven_edges: (regression.suffix_proof?.proven_edges ?? []).map((id) => `${prefix}${id}`),
      },
      prefix_reachability: { ...regression.prefix_reachability },
    })),
    submap: edge.submap ? {
      ...edge.submap,
      path: edge.submap.path ?? `${bindingPath}/${edge.submap.id}`,
    } : null,
  }));
  const incoming = new Set(edges.map((edge) => edge.to));
  const entries = nodes.filter((node) => !incoming.has(node.id));
  const exits = nodes.filter((node) => node.kind === "destination");
  const goalRegression = {
    ...model.goal_regression,
    steps: (model.goal_regression?.steps ?? []).map(regressionStep),
    edge_ids: (model.goal_regression?.edge_ids ?? []).map((id) => `${prefix}${id}`),
  };
  const container = {
    id: containerId,
    original_id: binding.id,
    kind: "submap",
    label: `${parentEdge?.title ?? binding.map_id}\n子地图已展开`,
    status: binding.source_status === "stale" ? "stale" : model.map.actual_arrival === "audited" ? "arrived" : "unsatisfied",
    predicates: [],
    proof_gaps: [],
    satisfied: model.map.actual_arrival === "audited",
    projection_only: true,
    submap: { ...binding, path: bindingPath },
    ...(parentContainerId ? { parent: parentContainerId } : {}),
  };
  const portalEdges = [];
  if (parentEdge) {
    for (const [index, entry] of entries.entries()) {
      portalEdges.push({
        id: `portal::${bindingPath.replaceAll("/", "::")}::entry-${index + 1}`,
        title: "进入子地图",
        from: parentEdge.from,
        to: entry.id,
        status: binding.source_status === "stale" ? "stale" : "verified",
        candidate: true,
        proven: true,
        ready: true,
        missing: [],
        preconditions: [],
        effects: [],
        invariants: [],
        applicable_invariants: [],
        evidence_contract: [],
        evidence: [],
        acceptance: [],
        proof_gaps: [],
        loops: [],
        brief: { ref: "projection-only", metadata: null, content: null },
        on_failure: { action: "none" },
        projection_only: true,
      });
    }
    for (const [index, exit] of exits.entries()) {
      portalEdges.push({
        id: `portal::${bindingPath.replaceAll("/", "::")}::exit-${index + 1}`,
        title: "子图到达回执",
        from: exit.id,
        to: parentEdge.to,
        status: ["current", "pinned"].includes(binding.receipt_status) ? "verified" : binding.receipt_status === "stale" ? "stale" : "blocked",
        candidate: true,
        proven: ["current", "pinned"].includes(binding.receipt_status),
        ready: binding.actual_arrival === "audited",
        missing: [],
        preconditions: [],
        effects: [],
        invariants: [],
        applicable_invariants: [],
        evidence_contract: [],
        evidence: [],
        acceptance: [],
        proof_gaps: [],
        loops: [],
        brief: { ref: "projection-only", metadata: null, content: null },
        on_failure: { action: "none" },
        projection_only: true,
      });
    }
  }
  return { predicates, nodes: [container, ...nodes], edges: [...edges, ...portalEdges], goal_regression: goalRegression, prefix, containerId };
}

function composeModel() {
  const root = runtime.rootModel;
  if (!root) return null;
  const model = structuredClone(root);
  for (const edge of model.edges) {
    if (edge.submap) edge.submap.path ??= edge.submap.id;
  }
  function appendSubmaps(parentModel, parentPrefix = "", parentPath = "", parentContainerId = null) {
    for (const binding of parentModel.submaps ?? []) {
      const bindingPath = binding.path ?? (parentPath ? `${parentPath}/${binding.id}` : binding.id);
      const parentEdge = model.edges.find((edge) => edge.id === `${parentPrefix}${binding.parent_edge}`);
      if (!parentEdge) continue;
      parentEdge.projection_hidden = true;
      const child = runtime.childModels.get(bindingPath);
      if (!runtime.expandedSubmaps.has(bindingPath) || !child) {
        const collapsed = collapsedSubmapElements(binding, parentEdge, bindingPath, parentContainerId);
        model.nodes.push(collapsed.node);
        model.edges.push(...collapsed.edges);
        continue;
      }
      const namespaced = namespacedChildModel(binding, child, bindingPath, parentEdge, parentContainerId);
      model.predicates.push(...namespaced.predicates);
      model.nodes.push(...namespaced.nodes);
      model.edges.push(...namespaced.edges);
      if (namespaced.goal_regression) {
        model.goal_regression.steps.push(...namespaced.goal_regression.steps);
        model.goal_regression.edge_ids.push(...namespaced.goal_regression.edge_ids);
      }
      appendSubmaps(child, namespaced.prefix, bindingPath, namespaced.containerId);
    }
  }
  appendSubmaps(root);
  return model;
}

function expansionStorageKey() {
  return `mapflow.expanded.${runtime.rootModel?.map.id ?? "unknown"}`;
}

function persistExpandedSubmaps() {
  try {
    sessionStorage.setItem(expansionStorageKey(), JSON.stringify([...runtime.expandedSubmaps]));
  } catch {}
}

function restoreExpandedSubmaps() {
  try {
    const stored = JSON.parse(sessionStorage.getItem(expansionStorageKey()) ?? "[]");
    const known = new Set((runtime.rootModel?.submaps ?? []).map((binding) => binding.id));
    const restored = new Set();
    for (const value of stored) {
      if (typeof value !== "string" || !/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*(?:\/[a-z][a-z0-9]*(?:-[a-z0-9]+)*)*$/.test(value)) continue;
      const segments = value.split("/");
      if (!known.has(segments[0])) continue;
      for (let index = 1; index <= segments.length; index += 1) restored.add(segments.slice(0, index).join("/"));
    }
    runtime.expandedSubmaps = restored;
  } catch {
    runtime.expandedSubmaps = new Set();
  }
}

async function fetchSubmap(bindingPath) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const etag = runtime.submapEtags.get(bindingPath);
    const encodedPath = bindingPath.split("/").map(encodeURIComponent).join("/");
    const binding = [runtime.rootModel, ...runtime.childModels.values()]
      .flatMap((model) => model?.submaps ?? [])
      .find((candidate) => (candidate.path ?? candidate.id) === bindingPath);
    const historical = runtime.rootModel?.evolution?.historical === true;
    if (historical && !binding?.historical_frame) {
      throw new Error("这个父帧没有固定 child revision；请进入子地图独立历史");
    }
    const endpoint = historical
      ? `/api/submaps/${encodedPath}/evolution/frames/${binding.historical_frame}`
      : `/api/submaps/${encodedPath}`;
    const response = await fetch(endpoint, {
      headers: etag ? { "If-None-Match": etag } : {},
      cache: "no-store",
      signal: controller.signal,
    });
    if (response.status === 304) return false;
    const body = await response.json();
    if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`);
    runtime.childModels.set(bindingPath, historical ? body.board : body);
    runtime.submapEtags.set(bindingPath, response.headers.get("ETag"));
    return true;
  } finally {
    window.clearTimeout(timeout);
  }
}

async function refreshExpandedSubmaps({ forceRender = false } = {}) {
  const ids = [...runtime.expandedSubmaps];
  if (!ids.length) return;
  let changed = forceRender;
  const results = await Promise.allSettled(ids.map(async (id) => {
    if (await fetchSubmap(id)) changed = true;
  }));
  const failure = results.find((result) => result.status === "rejected");
  if (failure) showFetchError(`子地图刷新失败：${failure.reason?.message ?? failure.reason}`);
  if (changed) renderCompositeModel(composeModel());
}

async function toggleSubmap(bindingPath) {
  if (runtime.expandedSubmaps.has(bindingPath)) {
    runtime.expandedSubmaps.delete(bindingPath);
    persistExpandedSubmaps();
    renderCompositeModel(composeModel());
    selectMapElement(submapContainerId(bindingPath));
    fitGraph();
    dom.announcer.textContent = `子地图 ${bindingPath} 已收缩`;
    return;
  }
  const binding = [runtime.rootModel, ...runtime.childModels.values()]
    .flatMap((model) => model?.submaps ?? [])
    .find((candidate) => (candidate.path ?? candidate.id) === bindingPath);
  if (runtime.rootModel?.evolution?.historical && !binding?.historical_frame) {
    await enterSubmapHistory(bindingPath);
    return;
  }
  runtime.expandedSubmaps.add(bindingPath);
  persistExpandedSubmaps();
  try {
    await fetchSubmap(bindingPath);
    renderCompositeModel(composeModel());
    selectMapElement(submapContainerId(bindingPath));
    focusSubmap(bindingPath);
    dom.announcer.textContent = `子地图 ${bindingPath} 已展开`;
  } catch (error) {
    runtime.expandedSubmaps.delete(bindingPath);
    persistExpandedSubmaps();
    showFetchError(`无法展开子地图：${error.message}`);
  }
}

function submapHistoryButton(bindingPath, pinnedFrame = null) {
  const button = element("button", "submap-toggle", pinnedFrame ? "回放此回执固定的子地图" : "查看子地图独立历史");
  button.type = "button";
  button.addEventListener("click", () => enterSubmapHistory(bindingPath, pinnedFrame).catch((error) => showFetchError(`无法读取子地图历史：${error.message}`)));
  return button;
}

export function topologySignature(model) {
  const nodes = model.nodes.map((node) => `${node.id}:${node.parent ?? ""}`).sort();
  const edges = model.edges.map((edge) => `${edge.id}:${edge.from}>${edge.to}`).sort();
  return JSON.stringify({ nodes, edges });
}

export function selectElementIds(model, lens = "proven", query = "") {
  const nodeIds = new Set();
  const edgeIds = new Set();
  const directMatches = new Set();

  if (model.projection.mode === "wayfinding" && (lens === "proven" || lens === "goal-regression")) {
    // In wayfinding, "current route" means the active reasoning surface,
    // which is the reverse candidate chain once regression has started.
    const regression = model.goal_regression;
    const showAllRegression = lens === "goal-regression";
    const currentTarget = model.wayfinding?.current_target ?? null;
    const regressionSteps = (regression?.steps ?? []).filter((step) => (
      showAllRegression
        || step.human_confirmed
        || (currentTarget?.kind === "node" && step.target_node === currentTarget.id)
        || step.target_node === regression?.origin_nodes?.[0]
        || step.target_node === regression?.destination?.node_id
    ));
    const regressionNodes = new Set(regressionSteps.map((step) => step.target_node));
    const regressionEdges = new Set((regression?.edge_ids ?? []).filter((id) => {
      if (showAllRegression) return true;
      const edge = model.edges.find((item) => item.id === id);
      return edge?.goal_regression?.[0]?.human_confirmed === true
        || (currentTarget?.kind === "edge" && edge?.id === currentTarget.id)
        || (currentTarget?.kind === "node" && (edge?.from === currentTarget.id || edge?.to === currentTarget.id));
    }));
    if (regressionNodes.size) {
      regressionNodes.forEach((id) => nodeIds.add(id));
      regressionEdges.forEach((id) => edgeIds.add(id));
      if (regression?.origin_nodes?.[0]) nodeIds.add(regression.origin_nodes[0]);
      if (regression?.destination?.node_id) nodeIds.add(regression.destination.node_id);
    } else {
      model.nodes.forEach((node) => nodeIds.add(node.id));
      model.edges.forEach((edge) => edgeIds.add(edge.id));
    }
  } else if (lens === "all") {
    model.nodes.forEach((node) => nodeIds.add(node.id));
    model.edges.forEach((edge) => edgeIds.add(edge.id));
  } else if (lens === "goal-regression") {
    const regression = model.goal_regression;
    const regressionNodes = new Set((regression?.steps ?? []).map((step) => step.target_node));
    for (const step of regression?.steps ?? []) {
      for (const edge of step.incoming_edges ?? []) {
        edgeIds.add(edge.edge_id);
        regressionNodes.add(edge.from);
        regressionNodes.add(edge.to);
      }
    }
    model.nodes.filter((node) => regressionNodes.has(node.id)).forEach((node) => nodeIds.add(node.id));
  } else if (lens === "fog") {
    model.nodes.filter((node) => (
      ["fog", "destination-fog", "conflict"].includes(node.status) || (node.proof_gaps?.length ?? 0) > 0
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
    if (edge.projection_hidden) edgeIds.delete(edge.id);
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
  const regression = node.goal_regression;
  return [
    "map-node",
    `kind-${classToken(node.kind)}`,
    `status-${classToken(node.status)}`,
    node.proof_gaps?.length ? "has-gap" : "",
    node.draft ? "is-draft" : "",
    node.projection_only ? "projection-only" : "",
    node.collapsed ? "is-collapsed-submap" : "",
    regression ? "goal-regression-node" : "",
    regression?.bridge_status ? `bridge-${classToken(regression.bridge_status)}` : "",
    regression?.human_confirmed ? "human-confirmed" : "",
    node.evolution_status ? `evolution-${classToken(node.evolution_status)}` : "",
    runtime.model?.projection.mode === "wayfinding" && runtime.model.wayfinding?.current_target?.id === node.id ? "current-target" : "",
  ].filter(Boolean).join(" ");
}

function flowRoleClasses(node, model = runtime.model) {
  if (node.kind === "submap") return "terrain-node";
  const edges = model?.edges ?? [];
  const hasIncoming = edges.some((edge) => edge.to === node.id && !edge.projection_hidden);
  return [
    "milestone-node",
    !hasIncoming && !node.parent && node.kind !== "destination" ? "flow-start" : "",
    node.kind === "destination" && node.status !== "destination-fog" ? "flow-end" : "",
    node.kind === "join" ? "flow-join" : "",
    node.kind === "decision" ? "flow-decision" : "",
  ].filter(Boolean).join(" ");
}

export function parallelEdgeLane(edge, model = runtime.model) {
  const siblings = (model?.edges ?? [])
    .filter((candidate) => candidate.from === edge.from && candidate.to === edge.to)
    .sort((left, right) => left.id.localeCompare(right.id));
  if (siblings.length < 2) return { className: "", offset: 0, labelOffset: 0 };
  const index = siblings.findIndex((candidate) => candidate.id === edge.id);
  const offset = (index - ((siblings.length - 1) / 2)) * 112;
  return {
    className: "parallel-lane",
    offset,
    labelOffset: offset < 0 ? -12 : 12,
  };
}

function edgeClasses(edge, model = runtime.model) {
  const regression = edge.goal_regression?.[0];
  const reverseRegression = runtime.model?.projection.mode === "wayfinding"
    && runtime.model.wayfinding?.phase === "regression";
  const lane = parallelEdgeLane(edge, model);
  return [
    "work-edge",
    `status-${classToken(edge.status)}`,
    edge.proven ? "is-proven" : "",
    edge.candidate ? "is-candidate" : "",
    edge.draft ? "is-draft" : "",
    edge.proof_gaps?.length ? "has-gap" : "",
    edge.projection_only ? "projection-only" : "",
    regression && reverseRegression ? "goal-regression-edge" : "",
    regression?.bridge_status ? `bridge-${classToken(regression.bridge_status)}` : "",
    regression?.human_confirmed ? "human-confirmed" : "",
    edge.evolution_status ? `evolution-${classToken(edge.evolution_status)}` : "",
    lane.className,
  ].filter(Boolean).join(" ");
}

function activityNodeId(edgeId) {
  return `activity::${edgeId}`;
}

function activityConnectorId(edgeId, side) {
  return `connector::${edgeId}::${side}`;
}

function activityStatusLabel(edge) {
  if (edge.status === "verified") return "已完成";
  if (edge.status === "active") return "进行中";
  if (edge.status === "ready") return "可开始";
  if (edge.status === "blocked") return "前置未满足";
  if (edge.status === "waiting") return "等待中";
  return statusLabel(edge.status);
}

export function activityGraphElements(model) {
  const nodeById = new Map(model.nodes.map((node) => [node.id, node]));
  const elements = model.nodes.map((node) => ({
    group: "nodes",
    data: {
      id: node.id,
      refId: node.id,
      refType: "node",
      label: node.label,
      kind: node.kind,
      status: node.status,
      ...(node.parent ? { parent: node.parent } : {}),
    },
    classes: `${nodeClasses(node)} ${flowRoleClasses(node, model)}`,
  }));

  for (const edge of model.edges) {
    const classes = edgeClasses(edge, model);
    if (edge.projection_only) {
      elements.push({
        group: "edges",
        data: {
          id: activityConnectorId(edge.id, "projection"),
          refId: edge.id,
          refType: "edge",
          source: edge.from,
          target: edge.to,
          label: edge.title,
          status: edge.status,
        },
        classes: `activity-connector projection-connector ${classes}`,
      });
      continue;
    }

    const sourceParent = nodeById.get(edge.from)?.parent;
    const targetParent = nodeById.get(edge.to)?.parent;
    const parent = sourceParent && sourceParent === targetParent ? sourceParent : null;
    const id = activityNodeId(edge.id);
    elements.push({
      group: "nodes",
      data: {
        id,
        refId: edge.id,
        refType: "edge",
        label: `${edge.title}\n${activityStatusLabel(edge)}`,
        kind: "activity",
        status: edge.status,
        ...(parent ? { parent } : {}),
      },
      classes: `activity-node ${classes}`,
    });
    elements.push(
      {
        group: "edges",
        data: {
          id: activityConnectorId(edge.id, "in"),
          refId: edge.id,
          refType: "edge",
          source: edge.from,
          target: id,
          status: edge.status,
        },
        classes: `activity-connector ${classes}`,
      },
      {
        group: "edges",
        data: {
          id: activityConnectorId(edge.id, "out"),
          refId: edge.id,
          refType: "edge",
          source: id,
          target: edge.to,
          status: edge.status,
        },
        classes: `activity-connector ${classes}`,
      },
    );
  }
  return elements;
}

function cytoscapeStyles() {
  return [
    {
      selector: "node",
      style: {
        "background-color": "#f9fbfa",
        "border-color": "#82938f",
        "border-width": 2,
        color: "#18252d",
        "font-family": "Bahnschrift, Segoe UI, sans-serif",
        "font-size": 10,
        "font-weight": 600,
        height: 28,
        label: "data(label)",
        padding: 4,
        shape: "ellipse",
        "text-halign": "center",
        "text-margin-y": 8,
        "text-max-width": 112,
        "text-valign": "bottom",
        "text-wrap": "wrap",
        width: 28,
      },
    },
    {
      selector: "node.activity-node",
      style: {
        "background-color": "#f9fbfa",
        "border-color": "#82938f",
        "border-width": 1.5,
        "font-size": 12,
        height: 66,
        padding: 10,
        shape: "round-rectangle",
        "text-margin-y": 0,
        "text-max-width": 158,
        "text-valign": "center",
        width: 188,
      },
    },
    { selector: "node.kind-destination", style: { shape: "diamond", height: 48, width: 48, "text-max-width": 126 } },
    { selector: "node.kind-join", style: { shape: "hexagon", height: 34, width: 38 } },
    { selector: "node.kind-submap", style: { shape: "round-rectangle", "background-opacity": 0.12, "background-color": "#cfe7e3", "border-color": "#16766f", "border-style": "dashed", "border-width": 2, padding: 28, "text-valign": "top", "text-margin-y": -12 } },
    { selector: "node.kind-submap.is-collapsed-submap", style: { "background-opacity": 1, "background-color": "#dcebea", "border-style": "solid", "font-size": 10, height: 92, padding: 10, "text-max-width": 166, "text-valign": "center", "text-margin-y": 0, width: 190 } },
    { selector: "node.kind-fog, node.status-fog", style: { "background-color": "#e1dfeb", "border-color": "#817c9d", "border-style": "dashed" } },
    { selector: "node.status-destination-fog", style: { shape: "diamond", "background-color": "#e6e0f0", "border-color": "#6f5c9a", "border-style": "dashed", "border-width": 2.5, height: 94, width: 130, "text-max-width": 96 } },
    { selector: "node.is-draft", style: { "border-color": "#bd731d", "border-style": "dashed", "border-width": 2.5 } },
    { selector: "node.status-satisfied", style: { "background-color": "#cfe7e3", "border-color": "#16766f", "border-width": 2 } },
    { selector: "node.status-arrived", style: { "background-color": "#16766f", "border-color": "#0b504b", color: "#ffffff", "border-width": 3 } },
    { selector: "node.status-historical-arrival", style: { "background-color": "#dcebea", "border-color": "#16766f", "border-style": "double", "border-width": 4 } },
    { selector: "node.status-drifted, node.status-conflict, node.has-gap", style: { "background-color": "#f1d5d2", "border-color": "#c8564f", "border-width": 2.5 } },
    { selector: "node.activity-node.status-verified", style: { "background-color": "#dcebe7", "border-color": "#16766f", color: "#17423f" } },
    { selector: "node.activity-node.status-active", style: { "background-color": "#f8e6c5", "border-color": "#bd731d", "border-width": 3 } },
    { selector: "node.activity-node.status-ready", style: { "background-color": "#fffaf0", "border-color": "#bd731d", "border-width": 2.5 } },
    { selector: "node.activity-node.status-blocked", style: { "background-color": "#eef1f0", "border-color": "#a8b2af", color: "#68767b", opacity: 0.78 } },
    { selector: "node.activity-node.status-failed, node.activity-node.status-stale", style: { "background-color": "#f1d5d2", "border-color": "#c8564f", "border-style": "dashed" } },
    { selector: "node.flow-start", style: { "background-color": "#18252d", "border-color": "#18252d", height: 18, width: 18, "text-margin-y": 12 } },
    { selector: "node.flow-end", style: { "background-color": "#f9fbfa", "border-color": "#18252d", "border-style": "double", "border-width": 4, height: 34, width: 34, "text-margin-y": 14 } },
    { selector: "node.flow-join", style: { "background-color": "#53636a", "border-color": "#53636a", height: 12, width: 44, "text-margin-y": 12, "text-max-width": 136 } },
    { selector: "node.flow-decision", style: { "background-color": "#fffaf0", "border-color": "#bd731d", shape: "diamond", height: 34, width: 34, "text-margin-y": 10 } },
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
    { selector: "edge.activity-connector", style: { label: "", "curve-style": "bezier", width: 1.5 } },
    { selector: "edge.projection-connector", style: { label: "data(label)", "font-size": 8, "line-style": "dotted" } },
    {
      selector: "edge.parallel-lane",
      style: {
        "control-point-distances": "data(parallelOffset)",
        "control-point-weights": 0.5,
        "curve-style": "unbundled-bezier",
        "text-margin-y": "data(parallelLabelOffset)",
      },
    },
    { selector: "edge.is-proven", style: { "line-color": "#53636a", "target-arrow-color": "#53636a", width: 2 } },
    { selector: "edge.status-verified", style: { "line-color": "#16766f", "target-arrow-color": "#16766f", width: 3 } },
    { selector: "edge.status-active", style: { "line-color": "#bd731d", "target-arrow-color": "#bd731d", "line-style": "dashed", "line-dash-pattern": [9, 6], width: 4 } },
    { selector: "edge.is-draft", style: { "line-color": "#bd731d", "target-arrow-color": "#bd731d", "line-style": "dashed", "line-dash-pattern": [5, 5], width: 2 } },
    { selector: "edge.status-blocked", style: { opacity: 0.56 } },
    { selector: "edge.status-failed, edge.status-stale", style: { "line-color": "#c8564f", "target-arrow-color": "#c8564f", "line-style": "dashed", width: 3 } },
    { selector: "edge.status-waiting", style: { "line-color": "#817c9d", "target-arrow-color": "#817c9d", "line-style": "dashed", width: 3 } },
    { selector: "edge.projection-only", style: { "line-color": "#16766f", "target-arrow-color": "#16766f", "line-style": "dotted", opacity: 0.72, width: 2 } },
    { selector: "edge.has-gap", style: { "line-color": "#c8564f", "target-arrow-color": "#c8564f", "line-style": "dashed", opacity: 1 } },
    { selector: "node.goal-regression-node", style: { "overlay-color": "#6f5c9a", "overlay-opacity": 0.04, "overlay-padding": 5 } },
    { selector: "edge.goal-regression-edge", style: { "line-style": "dashed", "line-dash-pattern": [5, 4], "source-arrow-shape": "triangle", "source-arrow-color": "#6f5c9a", "target-arrow-shape": "none", "line-color": "#6f5c9a" } },
    { selector: "node.current-target", style: { "border-color": "#bd731d", "border-width": 4, "overlay-color": "#bd731d", "overlay-opacity": 0.14, "overlay-padding": 9 } },
    { selector: "node.human-confirmed", style: { "border-color": "#16766f", "border-width": 3 } },
    { selector: "edge.human-confirmed", style: { "line-color": "#16766f", "source-arrow-color": "#16766f", width: 3 } },
    { selector: "node.evolution-added", style: { "border-color": "#16766f", "border-width": 5, "overlay-color": "#16766f", "overlay-opacity": 0.12, "overlay-padding": 9 } },
    { selector: "node.evolution-changed", style: { "border-color": "#bd731d", "border-width": 5, "overlay-color": "#bd731d", "overlay-opacity": 0.1, "overlay-padding": 8 } },
    { selector: "edge.evolution-added", style: { "line-color": "#16766f", "target-arrow-color": "#16766f", width: 5 } },
    { selector: "edge.evolution-changed", style: { "line-color": "#bd731d", "target-arrow-color": "#bd731d", width: 5 } },
    { selector: ".search-match", style: { "overlay-color": "#bd731d", "overlay-opacity": 0.16, "overlay-padding": 8 } },
    { selector: ":selected", style: { "border-color": "#bd731d", "border-width": 4, "line-color": "#bd731d", "target-arrow-color": "#bd731d", "source-arrow-color": "#bd731d", "z-index": 999 } },
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
  runtime.cy.on("tap", "node, edge", (event) => {
    const refId = event.target.data("refId") ?? event.target.id();
    selectMapElement(refId, true);
  });
  runtime.cy.on("dblclick", "node.kind-submap", (event) => {
    const node = runtime.model?.nodes.find((item) => item.id === event.target.id());
    const bindingPath = node?.submap?.path ?? node?.submap?.id;
    if (bindingPath) toggleSubmap(bindingPath);
  });
  runtime.cy.on("mouseover", "node.kind-submap", () => { dom.cy.style.cursor = "pointer"; });
  runtime.cy.on("mouseout", "node.kind-submap", () => { dom.cy.style.cursor = "default"; });
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
      cy.nodes().forEach((node) => runtime.positionLedger.set(node.id(), { ...node.position() }));
      const desired = activityGraphElements(model);
      const desiredIds = new Set(desired.map((item) => item.data.id));
      cy.elements().filter((item) => !desiredIds.has(item.id())).remove();
      const existingIds = new Set(cy.elements().map((item) => item.id()));
      const additions = desired.filter((item) => !existingIds.has(item.data.id));
      if (additions.length) cy.add(additions);
    }
    for (const node of model.nodes) {
       const graphNode = cy.getElementById(node.id);
       graphNode.data({ refId: node.id, refType: "node", label: node.label, kind: node.kind, status: node.status });
       graphNode.classes(`${nodeClasses(node)} ${flowRoleClasses(node, model)}`);
      const remembered = runtime.positionLedger.get(node.id);
      if (remembered && topologyChanged) graphNode.position(remembered);
    }
    for (const edge of model.edges) {
      const classes = edgeClasses(edge, model);
      if (edge.projection_only) {
        const graphEdge = cy.getElementById(activityConnectorId(edge.id, "projection"));
        graphEdge.data({ refId: edge.id, refType: "edge", label: edge.title, status: edge.status });
        graphEdge.classes(`activity-connector projection-connector ${classes}`);
        continue;
      }
      const graphNode = cy.getElementById(activityNodeId(edge.id));
      graphNode.data({
        refId: edge.id,
        refType: "edge",
        label: `${edge.title}\n${activityStatusLabel(edge)}`,
        kind: "activity",
        status: edge.status,
      });
      graphNode.classes(`activity-node ${classes}`);
      for (const side of ["in", "out"]) {
        const connector = cy.getElementById(activityConnectorId(edge.id, side));
        connector.data({ refId: edge.id, refType: "edge", status: edge.status });
        connector.classes(`activity-connector ${classes}`);
      }
    }
  });
}

function visibleCollection() {
  return runtime.cy?.elements().filter((item) => !item.hasClass("is-hidden")) ?? null;
}

function rememberVisiblePositions(nodes = runtime.cy?.nodes()) {
  nodes?.forEach((node) => runtime.positionLedger.set(node.id(), { ...node.position() }));
}

function layoutEvolutionGraph() {
  const visible = visibleCollection();
  const nodes = visible?.nodes();
  if (!nodes?.length) return;
  let orphanIndex = 0;
  const positions = {};
  nodes.forEach((node) => {
    const remembered = runtime.positionLedger.get(node.id());
    if (remembered) {
      positions[node.id()] = remembered;
      return;
    }
    const connected = node.connectedEdges().filter((edge) => !edge.hasClass("is-hidden"));
    const anchoredEdge = connected.find((edge) => {
      const other = edge.source().id() === node.id() ? edge.target() : edge.source();
      return runtime.positionLedger.has(other.id());
    });
    if (anchoredEdge) {
      const isSource = anchoredEdge.source().id() === node.id();
      const other = isSource ? anchoredEdge.target() : anchoredEdge.source();
      const anchor = runtime.positionLedger.get(other.id());
      positions[node.id()] = { x: anchor.x + (isSource ? -220 : 220), y: anchor.y + (orphanIndex % 3 - 1) * 90 };
    } else {
      positions[node.id()] = { x: (orphanIndex % 4) * 210, y: Math.floor(orphanIndex / 4) * 120 };
    }
    orphanIndex += 1;
  });
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  visible.layout({
    name: "preset",
    positions,
    fit: true,
    padding: 52,
    animate: !reduceMotion,
    animationDuration: reduceMotion ? 0 : 260,
    animationEasing: "ease-out",
  }).run();
  Object.entries(positions).forEach(([id, position]) => runtime.positionLedger.set(id, position));
  runtime.layoutCount += 1;
  dom.cy.dataset.layoutCount = String(runtime.layoutCount);
}

function layoutGraph() {
  if (!runtime.cy) return;
  const visible = visibleCollection();
  if (!visible?.length) return;
  const visibleNodes = visible.nodes();
  const isReverseRegression = runtime.model?.projection.mode === "wayfinding"
    && runtime.model.wayfinding?.phase === "regression"
    && runtime.model.goal_regression?.destination?.node_id;
  const destinationId = runtime.model?.goal_regression?.destination?.node_id;
  const originId = runtime.model?.goal_regression?.origin_nodes?.[0];
  if (
    runtime.model?.projection.mode === "wayfinding"
    && visibleNodes.length === 2
    && visible.edges().length === 0
    && originId
    && destinationId
  ) {
    const origin = runtime.cy.getElementById(originId);
    const destination = runtime.cy.getElementById(destinationId);
    if (origin.length && destination.length) {
      origin.position({ x: 0, y: 0 });
      destination.position({ x: 360, y: 0 });
      runtime.cy.fit(visible, 70);
      rememberVisiblePositions(visibleNodes);
      runtime.layoutCount += 1;
      dom.cy.dataset.layoutCount = String(runtime.layoutCount);
      return;
    }
  }
  const roots = isReverseRegression
    ? visibleNodes.filter((node) => node.id() === destinationId)
    : visibleNodes.filter((node) => node.connectedEdges().filter((edge) => (
      !edge.hasClass("is-hidden") && edge.target().id() === node.id()
    )).length === 0);
  visible.layout({
    name: "breadthfirst",
    directed: !isReverseRegression,
    fit: true,
    padding: 52,
    roots: roots.length ? roots : undefined,
    avoidOverlap: true,
    nodeDimensionsIncludeLabels: true,
    spacingFactor: isReverseRegression ? 1.18 : 1.08,
    animate: false,
  }).run();
  if (visibleNodes.length > 1) {
    // Turn breadth-first ranks into a left-to-right activity flow.
    const bounds = visibleNodes.boundingBox();
    const centerX = (bounds.x1 + bounds.x2) / 2;
    const centerY = (bounds.y1 + bounds.y2) / 2;
    const direction = isReverseRegression ? -1 : 1;
    visibleNodes.positions((node) => ({
      x: centerX + direction * (node.position("y") - centerY),
      y: centerY + (node.position("x") - centerX),
    }));
    const origin = isReverseRegression && originId ? runtime.cy.getElementById(originId) : null;
    const visibleOriginEdges = origin?.length
      ? origin.connectedEdges().filter((edge) => !edge.hasClass("is-hidden"))
      : null;
    if (origin?.length && visibleOriginEdges?.length === 0) {
      const routeNodes = visibleNodes.filter((node) => node.id() !== originId);
      if (routeNodes.length) {
        const routeBounds = routeNodes.boundingBox();
        origin.position({
          x: routeBounds.x1 - 210,
          y: (routeBounds.y1 + routeBounds.y2) / 2,
        });
      }
    }
    runtime.cy.fit(visible, 36);
  }
  runtime.layoutCount += 1;
  rememberVisiblePositions(visibleNodes);
  dom.cy.dataset.layoutCount = String(runtime.layoutCount);
}

function fitGraph() {
  const visible = visibleCollection();
  if (visible?.length) runtime.cy.fit(visible, 52);
}

function focusSubmap(bindingPath) {
  const container = runtime.cy?.getElementById(submapContainerId(bindingPath));
  if (!container?.length) return;
  const terrain = container.add(container.descendants().filter((item) => !item.hasClass("is-hidden")));
  runtime.cy.fit(terrain, 44);
}

function updateView({ fit = false } = {}) {
  if (!runtime.model || !runtime.cy) return;
  const selection = selectElementIds(runtime.model, runtime.lens, runtime.query);
  const visibleNodes = new Set(selection.nodes);
  const visibleEdges = new Set(selection.edges);
  for (const edge of runtime.model.edges) {
    if (edge.projection_hidden) visibleEdges.delete(edge.id);
  }
  const parentByNode = new Map(runtime.model.nodes.filter((node) => node.parent).map((node) => [node.id, node.parent]));
  for (const nodeId of [...visibleNodes]) {
    let parentId = parentByNode.get(nodeId);
    while (parentId) {
      visibleNodes.add(parentId);
      parentId = parentByNode.get(parentId);
    }
  }
  const matches = new Set(selection.matches);
  runtime.cy.batch(() => {
    runtime.cy.elements().forEach((item) => {
      const refId = item.data("refId") ?? item.id();
      const refType = item.data("refType") ?? (item.isNode() ? "node" : "edge");
      const visible = refType === "edge" ? visibleEdges.has(refId) : visibleNodes.has(refId);
      item.toggleClass("is-hidden", !visible);
      item.toggleClass("search-match", item.isNode() && matches.has(refId));
    });
  });
  dom.canvasEmpty.textContent = runtime.model?.projection.mode === "empty"
    ? "先了解现在已经有什么，再确认想完成的结果。"
    : runtime.model?.projection.mode === "wayfinding"
      ? "目标确认后，路线会从结果向现在逐步展开。"
      : "当前镜头没有匹配对象。";
  dom.canvasEmpty.hidden = visibleNodes.size + visibleEdges.size !== 0;
  dom.visibleCount.textContent = String(selection.nodes.length + selection.edges.length);
  renderElementList(selection);
  if (runtime.selected?.type === "element" && !visibleNodes.has(runtime.selected.id) && !visibleEdges.has(runtime.selected.id)) {
    const selectedEdge = runtime.model.edges.find((edge) => edge.id === runtime.selected.id);
    const expandedParent = selectedEdge?.submap?.path && runtime.expandedSubmaps.has(selectedEdge.submap.path);
    if (!expandedParent) selectOverview();
  }
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

function wayfindingPhaseTitle(model) {
  const phase = model.wayfinding?.phase ?? model.map.wayfinding_phase;
  if (phase === "survey") return "先了解我们从哪里出发";
  if (phase === "shaping") return "先确认第一版要做到什么";
  if (phase === "regression") return "正在从结果倒推出完整路线";
  return "正在整理路线";
}

export function wayfindingNextAction(phase) {
  if (phase === "survey") return "先说清楚现在已经有什么、还缺什么。";
  if (phase === "shaping") return "确认第一版的完成标准和暂不包含的范围。";
  if (phase === "regression") return "检查从结果倒推的完整路线，再决定从哪里开始。";
  return "先完成当前唯一的问题，页面会给出下一步。";
}

export function wayfindingDestinationView(model) {
  const destination = model.map?.destination ?? {};
  const draftDestination = model.wayfinding?.draft_nodes?.find((node) => (
    node.id === destination.id || node.kind === "destination" || node.status === "destination-fog"
  ));
  const status = destination.status
    ?? (draftDestination?.status === "destination-fog" ? "fog" : "pending");
  const label = destination.label ?? draftDestination?.label ?? "目的地尚未定形";
  const statement = destination.statement ?? draftDestination?.statement ?? "尚未定形目的地";
  return { status, label, statement };
}

export function humanDestinationTitle(model) {
  const destination = wayfindingDestinationView(model);
  const label = String(destination.label ?? "")
    .replace(/\bMVP\b/gi, "")
    .replace(/目的地/g, "")
    .replace(/(?:尚未定形|待确认|等待确认)/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return label.length >= 4 && label.length <= 32 ? label : destination.statement;
}

function canvasEyebrow(model) {
  if (model.projection.mode === "empty") return "路线";
  if (model.projection.mode === "wayfinding") {
    const phase = model.wayfinding?.phase ?? model.map.wayfinding_phase;
    return phase === "survey" ? "了解现状" : phase === "shaping" ? "路线准备中" : "从结果倒推";
  }
  return model.map.phase === "implementation" ? "正在推进" : "完整路线";
}

function destinationContextText(model) {
  if (model.projection.mode === "wayfinding") {
    const destination = wayfindingDestinationView(model);
    return ["confirmed", "destination"].includes(destination.status)
      ? "目标已经确认 · 路线正在根据完成标准展开"
      : "请先确认这是不是你想要的第一版 · 确认前不会生成路线或开始实施";
  }
  if (model.map.current_destination?.status === "drifted") return "历史到达仍保留 · 当前事实变化，路线正在重算";
  if ((model.summary.arrival_checkpoints ?? 0) > 0) return `已有 ${model.summary.arrival_checkpoints} 个历史到达 · 当前航段随事实刷新`;
  return "地图随事实和证据刷新 · 到达需要责任人确认";
}

function renderWayfindingChrome(model) {
  const isWayfinding = model.projection.mode === "wayfinding";
  dom.wayfindingRail.hidden = !isWayfinding;
  dom.canvasExplanation.hidden = !isWayfinding;
  if (!isWayfinding) {
    dom.wayfindingRail.replaceChildren();
    dom.canvasExplanation.replaceChildren();
    return;
  }

  const phase = model.wayfinding?.phase ?? model.map.wayfinding_phase;
  const phases = ["survey", "shaping", "regression"];
  const rail = element("ol", "wayfinding-steps");
  for (const name of phases) {
    const item = element("li", `wayfinding-step${name === phase ? " is-current" : ""}${phases.indexOf(name) < phases.indexOf(phase) ? " is-complete" : ""}`);
    item.append(element("span", "wayfinding-step-index", String(phases.indexOf(name) + 1)), element("span", "wayfinding-step-label", WAYFINDING_PHASE_LABELS[name]));
    rail.append(item);
  }
  dom.wayfindingRail.replaceChildren(rail);

  const current = model.wayfinding?.current_target;
  const currentQuestion = model.wayfinding?.questions?.find((question) => question.id === model.wayfinding.current_question_id);
  const explanation = [];
  if (phase === "survey") explanation.push("先了解现在已经具备什么。路线还不会开始。");
  if (phase === "shaping") explanation.push("先把“完成”说清楚。确认目标后，这里才会展开实现与验收路线。");
  if (phase === "regression") {
    const steps = model.goal_regression?.steps ?? [];
    explanation.push("当前从目的地向始发地提出里程碑候选；紫色箭头表示反向推理，橙色虚线表示尚未进入正式图。");
    if (steps.length) {
      const levels = new Map();
      for (const step of steps) {
        const labels = levels.get(step.depth) ?? [];
        labels.push(step.target_label);
        levels.set(step.depth, labels);
      }
      const summary = [...levels.entries()]
        .sort(([left], [right]) => left - right)
        .map(([depth, labels]) => `第${depth}层：${labels.join(" / ")}`)
        .join("；");
      explanation.push(`回归层级（从目的地向始发地）：${summary}`);
      if ([...levels.values()].some((labels) => labels.length > 1)) {
        explanation.push("同层多个候选是并列或 OR 分支，不代表彼此相连；具体边关系以画布和检查器为准。");
      }
    }
  }
  if (currentQuestion) explanation.push(`现在需要你：${humanQuestionText(currentQuestion)}`);
  if (phase !== "regression" && (model.summary.draft_edges ?? 0) === 0) explanation.push("目标确认后，Mapflow 会从结果倒推出完整路线。");
  if (phase === "regression" && (model.summary.draft_edges ?? 0) > 0) explanation.push("完整候选链留在‘全部候选’镜头供整体审阅；写入 Blueprint 并通过 validate/prove 与 init/replan 后才成为正式拓扑。");
  dom.canvasExplanation.replaceChildren(element("span", "canvas-explanation-text", explanation.join("\n")));
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
  if (model.projection.mode === "wayfinding") {
    const phase = model.wayfinding?.phase ?? model.map.wayfinding_phase;
    const counts = phase === "shaping" ? [
      ["待确认", "第一版目标"],
      ["未生成", "工作路线"],
      [`${model.summary.open_questions ?? 0}`, "需要你决定"],
      ["下一步", "从结果倒推"],
    ] : [
      [`${model.summary.draft_edges ?? 0}`, "路线中的任务"],
      [`${model.summary.draft_nodes ?? 0}`, "关键里程碑"],
      [`${model.summary.open_questions ?? 0}`, "需要你决定"],
      [WAYFINDING_PHASE_LABELS[phase] ?? "整理路线", "当前进度"],
    ];
    dom.mapCounts.replaceChildren(...counts.map(([value, label]) => {
      const card = element("div", "count-card");
      card.append(element("strong", "", value), element("span", "", label));
      return card;
    }));
    return;
  }
  const pendingHuman = (model.summary.pending_authorizations ?? 0)
    + (model.summary.pending_arrival_audits ?? 0)
    + (model.summary.pending_proposals ?? 0);
  const counts = [
    [`${model.summary.verified_edges}/${model.summary.edges}`, "任务完成"],
    [model.summary.ready_edges?.length ?? 0, "可开始"],
    [model.summary.proof_gaps, "待补缺口"],
    [pendingHuman, "待你处理"],
  ];
  dom.mapCounts.replaceChildren(...counts.map(([value, label]) => {
    const card = element("div", "count-card");
    card.append(element("strong", "", value), element("span", "", label));
    return card;
  }));
}

function renderGoalSummary(model) {
  const destination = wayfindingDestinationView(model);
  const acceptance = model.map?.destination?.acceptance ?? [];
  const visible = model.projection?.mode === "wayfinding" && acceptance.length > 0;
  dom.goalSummary.hidden = !visible;
  if (!visible) return;
  const origin = model.nodes?.find((node) => node.id !== destination.id && node.kind !== "destination")
    ?? model.nodes?.find((node) => node.id !== destination.id);
  dom.journeyOrigin.textContent = humanSurfaceText(origin?.label ?? "当前工作起点");
  dom.journeyDestination.textContent = humanSurfaceText(destination.statement);
  dom.goalSummaryStatus.textContent = ["confirmed", "destination"].includes(destination.status) ? "已经确认" : "等待你确认";
  dom.goalCriteria.replaceChildren(...acceptance.map((item) => element("li", "", humanSurfaceText(item.proof))));
  const outOfScope = model.map?.boundaries?.out_of_scope ?? [];
  dom.goalOutOfScope.closest("details").hidden = outOfScope.length === 0;
  dom.goalOutOfScope.replaceChildren(...outOfScope.map((item) => element("li", "", humanSurfaceText(item))));
}

function setWayfindingResponseStatus(message = "", tone = "") {
  dom.wayfindingResponseStatus.textContent = message;
  dom.wayfindingResponseStatus.classList.toggle("is-error", tone === "error");
  dom.wayfindingResponseStatus.classList.toggle("is-success", tone === "success");
}

function renderWayfindingResponse(model) {
  const interaction = wayfindingInteractionView(model);
  const receipt = interactionReceiptView(runtime.actionReceipt, model);
  if (receipt && receipt.status !== runtime.actionReceipt?.status) persistActionReceipt(receipt);
  dom.wayfindingResponse.hidden = !interaction.enabled && !receipt;
  dom.wayfindingResponseActions.hidden = !interaction.enabled;
  if (!interaction.enabled) {
    runtime.actionQuestionId = null;
    runtime.actionBusy = false;
    dom.adjustmentForm.hidden = true;
    dom.adjustment.value = "";
    if (receipt) setWayfindingResponseStatus(receipt.message, "success");
    else setWayfindingResponseStatus();
    return;
  }
  if (runtime.actionQuestionId !== interaction.question_id) {
    runtime.actionQuestionId = interaction.question_id;
    runtime.actionBusy = false;
    dom.adjustmentForm.hidden = true;
    dom.adjustment.value = "";
    if (!receipt) setWayfindingResponseStatus();
  }
  dom.confirmDestination.disabled = runtime.actionBusy;
  dom.adjustDestination.disabled = runtime.actionBusy;
  for (const button of dom.adjustmentForm.querySelectorAll("button")) button.disabled = runtime.actionBusy;
  if (receipt) setWayfindingResponseStatus(receipt.message, "success");
}

async function submitWayfindingChoice(choice, adjustment = "") {
  const interaction = wayfindingInteractionView(runtime.liveModel ?? runtime.model);
  if (!interaction.enabled || runtime.actionBusy) return;
  runtime.actionBusy = true;
  renderWayfindingResponse(runtime.liveModel ?? runtime.model);
  setWayfindingResponseStatus(choice === "confirm" ? "正在记录你的确认…" : "正在记录调整意见…");
  try {
    const response = await fetch(interaction.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Mapflow-Action-Token": interaction.token,
      },
      body: JSON.stringify({
        question_id: interaction.question_id,
        revision: interaction.revision,
        choice,
        adjustment,
      }),
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`);
    persistActionReceipt({
      schema: ACTION_RECEIPT_KEY,
      workspace_id: body.workspace_id ?? null,
      question_id: interaction.question_id,
      choice,
      recorded_revision: body.recorded_revision ?? body.revision,
      status: body.application_status ?? "recorded",
    });
    runtime.actionBusy = false;
    setWayfindingResponseStatus("已记录，等待 Codex 处理", "success");
    runtime.etag = null;
    await pollBoard();
  } catch (error) {
    runtime.actionBusy = false;
    renderWayfindingResponse(runtime.liveModel ?? runtime.model);
    setWayfindingResponseStatus(error.message, "error");
  }
}

function renderCurrentAction(model) {
  const action = currentActionView(model);
  dom.actionGate.dataset.state = action.state;
  dom.actionState.textContent = action.state_label;
  dom.actionTitle.textContent = action.title;
  dom.actionQuestion.textContent = action.question;
  dom.actionOwner.textContent = action.requested_by
    ? `${action.owner}\n发起者：${action.requested_by}`
    : action.owner;
  dom.actionAfter.textContent = action.after;
  renderWayfindingResponse(model);
}

function renderCurrentPosition(model) {
  const position = navigationPositionView(model);
  dom.currentPosition.dataset.state = position.state;
  dom.currentPositionTitle.textContent = position.label;
  dom.currentPositionDetail.textContent = position.detail;
}

function renderElementList(selection) {
  const matches = new Set(selection.matches);
  const nodes = runtime.model.nodes.filter((node) => selection.nodes.includes(node.id));
  const edges = runtime.model.edges.filter((edge) => selection.edges.includes(edge.id));
  const buttons = [];
  for (const edge of edges) {
    buttons.push(elementButton({
      id: edge.id,
      name: edge.title,
      meta: `${edge.draft ? "候选任务" : "任务"} · ${edgeExecutionLabel(edge, runtime.model)}`,
      symbol: edge.draft ? "⇢" : "→",
      matched: matches.has(edge.id),
    }));
  }
  for (const node of nodes) {
    buttons.push(elementButton({
      id: node.id,
      name: node.label,
      meta: `${KIND_LABELS[node.kind] ?? node.kind} · ${statusLabel(node.status)}`,
      symbol: node.draft ? "◇" : "○",
      matched: matches.has(node.id),
      submapPath: node.kind === "submap" ? node.submap?.path ?? node.submap?.id : null,
    }));
  }
  if (!buttons.length) dom.elementList.replaceChildren(element(
    "p",
    "empty-note",
    runtime.model?.projection.mode === "empty"
      ? "还没有可导航对象；先完成勘探。"
      : runtime.model?.projection.mode === "wayfinding"
        ? "当前为待确认候选；选择对象可查看它要建立的节点、边或问题。"
        : "当前镜头没有匹配对象。切换镜头或清除搜索可继续探索。",
  ));
  else dom.elementList.replaceChildren(...buttons);
}

function elementButton({ id, name, meta, symbol, matched, submapPath = null }) {
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
  if (submapPath) {
    button.title = runtime.expandedSubmaps.has(submapPath) ? "双击收缩子地图" : "双击展开子地图";
    button.addEventListener("dblclick", (event) => {
      event.preventDefault();
      toggleSubmap(submapPath);
    });
  }
  return button;
}

function setInspectorOpen(open, { fit = true } = {}) {
  dom.inspector.hidden = !open;
  dom.inspectorToggle.setAttribute("aria-expanded", String(open));
  dom.workbench.classList.toggle("has-inspector", open);
  window.requestAnimationFrame(() => {
    runtime.cy?.resize();
    if (fit) fitGraph();
  });
}

function selectMapElement(id, focusInspector = false) {
  const node = runtime.model?.nodes.find((item) => item.id === id);
  const edge = runtime.model?.edges.find((item) => item.id === id);
  if (!node && !edge) return;
  if (focusInspector) setInspectorOpen(true);
  runtime.selected = { type: "element", id };
  runtime.cy?.elements().unselect();
  const graphId = edge && !edge.projection_only
    ? activityNodeId(edge.id)
    : edge
      ? activityConnectorId(edge.id, "projection")
      : id;
  runtime.cy?.getElementById(graphId).select();
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

function regressionTone(value) {
  if (["connected", "observed", "logical"].includes(value)) return "good";
  if (["model-only", "conditional", "awaiting-prefix"].includes(value)) return "warn";
  if (["fog", "unreachable", "suffix-unproven"].includes(value)) return "bad";
  return "";
}

function regressionStepItem(step) {
  const item = element("li", "regression-step");
  const header = element("div", "regression-step-header");
  const target = element("button", "regression-target", `${step.depth}. ${step.target_label}`);
  target.type = "button";
  target.setAttribute("aria-label", `查看回归候选 ${step.target_label}`);
  target.addEventListener("click", () => selectMapElement(step.target_node, true));
  const confirmationLabel = step.formal
    ? "已进入正式图"
    : step.human_confirmed
      ? "旧记录：已审阅"
      : "候选链审阅";
  header.append(
    target,
    makeChip(REGRESSION_LABELS[step.bridge_status] ?? step.bridge_status, regressionTone(step.bridge_status)),
    makeChip(confirmationLabel, step.formal || step.human_confirmed ? "teal" : "amber"),
  );
  item.append(header);
  item.append(element("p", "regression-detail", `目标侧后缀：${REGRESSION_LABELS[step.suffix_proof.status] ?? step.suffix_proof.status} · 当前前缀：${REGRESSION_LABELS[step.prefix_reachability.status] ?? step.prefix_reachability.status}`));
  const edgeList = element("div", "regression-edge-list");
  for (const edge of step.incoming_edges ?? []) {
    const edgeItem = element("div", "regression-edge-item");
    const edgeButton = element("button", "regression-edge", `← ${edge.edge_id} · ${edge.brief_ref}`);
    edgeButton.type = "button";
    edgeButton.addEventListener("click", () => selectMapElement(edge.edge_id, true));
    edgeItem.append(edgeButton);
    const edgeConfirmation = edge.formal ? "已进入正式图" : edge.human_confirmed ? "旧记录：已审阅" : "候选合同待整体审阅";
    edgeItem.append(element("span", "regression-edge-contract", `${edgeConfirmation} · 验收 ${edge.acceptance?.length ? edge.acceptance.map((item) => item.status === "passed" ? "通过" : "待验").join("/") : "待补合同"} · 非目标 ${asText(edge.non_goals)}`));
    edgeList.append(edgeItem);
  }
  if (edgeList.childElementCount) item.append(edgeList);
  return item;
}

function regressionSection(model) {
  const regression = model.goal_regression ?? { steps: [], unconfirmed_candidates: [] };
  const section = element("section", "ledger-section regression-section");
  section.append(element("h3", "", "目标回归：从目的地向始发地"));
  section.append(element("p", "regression-note", regression.confirmation_note ?? "回归候选是独立的建模层，不会自动进入正式地图。"));
  const closure = regression.complete_chain
    ? "已闭合到始发节点"
    : `仍有未闭合桥接${regression.unclosed_terminals?.length ? `：${regression.unclosed_terminals.join("、")}` : ""}`;
  section.append(element("p", "regression-detail", `回归层级 ${regression.steps?.length ?? 0} · 候选边 ${regression.edge_ids?.length ?? 0} · ${closure}`));
  const list = element("ol", "regression-list");
  list.append(...(regression.steps ?? []).map(regressionStepItem));
  if (list.childElementCount) section.append(list);
  else section.append(element("p", "empty-note", "当前还没有已确认的目标回归节点。"));
  if ((regression.unconfirmed_candidates ?? []).length) {
    section.append(ledgerSection("待人确认候选（不会进入正式图）", regression.unconfirmed_candidates.map((candidate) => labeledValue(
      `${candidate.id ?? "candidate"} · ${candidate.kind ?? "node/edge"}`,
      candidate.summary ?? candidate.reason ?? asText(candidate),
      "warn",
    ))));
  }
  return section;
}

function renderOverview(model) {
  if (model.projection.mode === "empty") {
    const content = [hero({
      eyebrow: "EMPTY WORKSPACE",
      title: model.map.destination.statement,
      id: model.map.id,
      chips: [makeChip("尚未开始", "amber"), makeChip("只读投影", "teal")],
    })];
    content.push(ledgerSection("下一步", model.empty_state.next_steps.map((step, index) => (
      labeledValue(`${index + 1}.`, step)
    ))));
    content.push(ledgerSection("当前边界", [
      labeledValue("Intent", "尚未记录；先描述要解决的价值诉求和开放问题。", "warn"),
      labeledValue("Destination", "尚未定形；不能把一句愿望直接当成可验收目标。", "warn"),
      labeledValue("正式拓扑", "0 个节点 · 0 条边；候选不会被自动画入看板。", "good"),
      labeledValue("确认门", model.goal_regression.confirmation_note, "warn"),
    ]));
    content.push(ledgerSection("空白工作区说明", [
      labeledValue("事实", "尚未勘探，不存在可供推演的 true/false/unknown/conflict Fact。"),
      labeledValue("证明", "尚未运行；地图建立后才会计算结构完整性和正向可达性。"),
      labeledValue("运行态", "没有 Blueprint、Brief、events 或 state；Mapflow Sidecar 仍位于目标工作区之外。"),
    ]));
    dom.inspectorContent.replaceChildren(...content);
    return;
  }
  if (model.projection.mode === "wayfinding") {
    const destination = wayfindingDestinationView(model);
    const regressionReady = model.wayfinding?.phase === "regression"
      && model.goal_regression?.complete_chain
      && !model.wayfinding?.current_target;
    const content = [hero({
      eyebrow: "WAYFINDING DRAFT",
      title: wayfindingPhaseTitle(model),
      id: model.map.id,
      chips: [makeChip(regressionReady ? "候选链闭合，待登记" : "候选链审阅中", regressionReady ? "teal" : "amber"), makeChip("只读投影", "teal")],
    })];
    content.push(ledgerSection("当前建模进度", [
      labeledValue("当前阶段", WAYFINDING_PHASE_LABELS[model.wayfinding?.phase ?? model.map.wayfinding_phase] ?? "探路建模", "warn"),
      labeledValue("始发候选", model.nodes.find((node) => node.id === model.goal_regression.origin_nodes?.[0])?.label ?? "未记录", "warn"),
      labeledValue("本轮焦点", model.wayfinding?.current_target
        ? `${TARGET_KIND_LABELS[model.wayfinding.current_target.kind] ?? model.wayfinding.current_target.kind}：${model.wayfinding.current_target.label}（${model.wayfinding.current_target.id}）`
        : regressionReady ? "候选链已闭合，等待生成 Task Brief 与正式 Blueprint" : "等待人工指定下一个收敛目标"),
      labeledValue("正式拓扑", "0 个节点 · 0 条边", "good"),
      labeledValue("草稿候选", `${model.summary.draft_nodes} 个节点 · ${model.summary.draft_edges} 条边`),
    ]));
    content.push(ledgerSection("当前 Intent 与目的地", [
      labeledValue("Intent", `${statusLabel(model.map.intent.status)} · ${model.map.intent.statement}`, model.map.intent.status === "shaped" ? "good" : "warn"),
      labeledValue("Destination", `${statusLabel(destination.status)} · ${destination.label}\n${destination.status === "pending" || destination.status === "fog" ? `候选陈述（未确认）：${destination.statement}` : destination.statement}`, destination.status === "confirmed" ? "good" : "warn"),
    ]));
    content.push(ledgerSection("目的地合同", [
      labeledValue("目标谓词", model.map.destination.requires?.length ? model.map.destination.requires : "尚未收敛", model.map.destination.requires?.length ? "good" : "warn"),
      labeledValue("验收映射", model.map.destination.acceptance?.length
        ? model.map.destination.acceptance.map((item) => `${item.id} → ${asText(item.proves)}：${item.proof}`).join("\n")
        : "尚未收敛", model.map.destination.acceptance?.length ? "good" : "warn"),
      labeledValue("范围内", model.map.boundaries.in_scope?.length ? model.map.boundaries.in_scope : "尚未收敛"),
      labeledValue("非目标", model.map.boundaries.out_of_scope?.length ? model.map.boundaries.out_of_scope : "尚未收敛"),
      labeledValue("授权边界", model.map.boundaries.authorization?.length ? model.map.boundaries.authorization : "尚未收敛"),
      labeledValue("全程不变量", model.map.destination.invariants?.length ? model.map.destination.invariants : "无或尚未收敛"),
    ]));
    content.push(ledgerSection("待收敛问题", (model.questions ?? []).map((question) => labeledValue(
      `${question.id} · ${question.status ?? "pending"}`,
      `${question.prompt}\n目标${TARGET_KIND_LABELS[question.target.kind] ?? question.target.kind}：${question.target.label}（${question.target.id}）\n目的：${question.target.purpose}\n${questionUpdateLabel(question)}`,
      question.status === "answered" ? "good" : "warn",
    )), "当前没有带建模目标的问题。"));
    content.push(ledgerSection("登记门", [
      labeledValue("候选状态", "始发节点、目的地候选和问题目标均未进入正式 Blueprint。"),
      labeledValue("路径规则", model.summary.draft_edges
        ? "候选工作边必须补齐前置、效果、因果、验收、交接和上下文合同，再整体审阅并证明。"
        : "目的地尚未确认时不创建 origin → destination 直连边；确认后才进入反向目标回归。", "warn"),
      labeledValue("下一步", model.empty_state?.next_steps?.[0] ?? wayfindingNextAction(model.wayfinding?.phase ?? model.map.wayfinding_phase), "warn"),
    ]));
    if ((model.wayfinding?.phase ?? model.map.wayfinding_phase) === "regression") content.push(regressionSection(model));
    dom.inspectorContent.replaceChildren(...content);
    return;
  }
  const proof = model.proof;
  const action = currentActionView(model);
  const position = navigationPositionView(model);
  const content = [hero({
    eyebrow: "CURRENT POSITION",
    title: position.label,
    id: model.map.id,
    chips: [
      makeChip(position.detail, statusTone(position.state)),
      makeChip(REACHABILITY_LABELS[proof.reachability] ?? proof.reachability, proof.reachability === "unreachable" ? "coral" : "teal"),
      makeChip(ARRIVAL_LABELS[model.map.actual_arrival] ?? model.map.actual_arrival, model.map.actual_arrival === "audited" ? "teal" : ""),
    ],
  })];

  content.push(ledgerSection("下一步", [
    labeledValue(action.state_label, `${action.title}\n${action.question}`, ["waiting-human", "in-progress"].includes(action.state) ? "warn" : action.state === "complete" ? "good" : ""),
    labeledValue("责任人", action.requested_by ? `${action.owner}\n发起者：${action.requested_by}` : action.owner),
    labeledValue("完成后", action.after),
  ]));
  content.push(ledgerSection("路线进度", [
    labeledValue("任务", `${model.summary.verified_edges}/${model.summary.edges} 已完成`, model.summary.verified_edges === model.summary.edges ? "good" : "warn"),
    labeledValue("可开始", model.summary.ready_edges?.length
      ? model.edges.filter((edge) => model.summary.ready_edges.includes(edge.id)).map((edge) => edge.title)
      : "无"),
    labeledValue("目的地验收", `${model.summary.acceptance_passed}/${model.summary.acceptance_total} 通过`, model.summary.acceptance_passed === model.summary.acceptance_total ? "good" : "warn"),
    labeledValue("路线缺口", model.proof_gaps.length ? `${model.proof_gaps.length} 个` : "无", model.proof_gaps.length ? "bad" : "good"),
  ]));

  const advanced = [
    ledgerSection("正向可达性证明", [
      labeledValue("结构", STRUCTURAL_LABELS[proof.structural] ?? proof.structural),
      labeledValue("逻辑结论", REACHABILITY_LABELS[proof.reachability] ?? proof.reachability, proof.reachability === "unreachable" ? "bad" : "good"),
      labeledValue("候选任务", proof.candidate_edges),
      labeledValue("证明路线任务", proof.proven_edges),
      labeledValue("使用的假设", proof.assumptions_used),
    ]),
    ledgerSection("证据层级", Object.entries(model.evidence_levels ?? proof.evidence_levels ?? {}).map(([id, level]) => labeledValue(
      EVIDENCE_LEVEL_LABELS[id] ?? id,
      `${statusLabel(level.status)}${level.basis ? `\n${level.basis}` : ""}`,
      ["established", "complete", "logical", "ready", "active"].includes(level.status) ? "good" : level.status === "failed" || level.status === "blocked" ? "bad" : "warn",
    ))),
    ledgerSection("航段连续性", [
      labeledValue("当前 Destination", `${model.map.current_destination?.node_id ?? "尚未登记"} · ${statusLabel(model.map.current_destination?.status)}`, model.map.current_destination?.status === "drifted" ? "bad" : "good"),
      labeledValue("当前缺失", model.map.current_destination?.missing?.length ? model.map.current_destination.missing : "无"),
      labeledValue("历史 Arrival", model.arrival_checkpoints?.length
        ? model.arrival_checkpoints.map((checkpoint) => `${checkpoint.id} · ${checkpoint.destination.statement} · ${formatTimestamp(checkpoint.recorded_at)}`)
        : "尚无"),
      labeledValue("后继航段", model.successor_bindings?.length
        ? model.successor_bindings.map((binding) => `${binding.id} · ${binding.origin_node} -> ${binding.destination_node.id}`)
        : "尚无"),
    ]),
    regressionSection(model),
    ledgerSection("人工门", [
      ...model.authorization_requests.filter((request) => request.status === "pending").map((request) => labeledValue(
        `${request.id} · 待回答`,
        `任务：${request.edge}\n问题：${request.question}\n责任人：${decisionOwnerLabel(request)}\n请求者：${request.requested_by}`,
        "warn",
      )),
      ...(model.arrival_audit_requests ?? []).map((request) => labeledValue(
        `${request.id} · ${request.status === "pending" ? "到达待审计" : request.status === "granted" ? "到达已审计" : request.status}`,
        `问题：${request.question}\n责任人：${decisionOwnerLabel(request)}\n冻结验收：${asText(request.acceptance)}\n请求者：${request.requested_by}\n回答：${request.answer ?? "尚未回答"}\n审计人：${request.audited_by ?? "尚未记录"}`,
        request.status === "granted" ? "good" : request.status === "pending" ? "warn" : request.status === "stale" ? "bad" : "",
      )),
    ], "当前没有施工授权或到达审计请求。"),
    ledgerSection("目的地验收", model.acceptance.map((acceptance) => labeledValue(
      `${acceptance.id} · ${acceptance.status === "passed" ? "通过" : "待验"}`,
      `${acceptance.proof}\n证明：${asText(acceptance.proves)}${acceptance.missing?.length ? `\n缺少：${asText(acceptance.missing)}` : ""}`,
      acceptance.status === "passed" ? "good" : "warn",
    ))),
    ledgerSection("子地图", (model.submaps ?? []).map((binding) => labeledValue(
      `${binding.id} · ${statusLabel(binding.source_status)}`,
      `${binding.map_id}\n阶段：${PHASE_LABELS[binding.phase] ?? binding.phase} · 到达：${ARRIVAL_LABELS[binding.actual_arrival] ?? binding.actual_arrival}\n验收：${binding.acceptance_passed}/${binding.acceptance_total} · 迷雾：${binding.fog_nodes}\n回执：${statusLabel(binding.receipt_status)}`,
      binding.source_status === "stale" || binding.receipt_status === "stale" ? "bad" : binding.actual_arrival === "audited" ? "good" : "warn",
    )), "当前地图没有绑定子地图。"),
    ledgerSection("工作边界", [
      labeledValue("范围内", model.map.boundaries.in_scope),
      labeledValue("范围外", model.map.boundaries.out_of_scope),
      labeledValue("授权", model.map.boundaries.authorization),
      labeledValue("全程不变量", model.map.destination.invariants),
    ]),
  ];
  content.push(ledgerDisclosure("证据、验收与边界", advanced, `${model.summary.acceptance_passed}/${model.summary.acceptance_total}`));
  dom.inspectorContent.replaceChildren(...content);
}

function renderNodeInspector(node) {
  if (node.kind === "submap" && node.submap) {
    const binding = node.submap;
    const content = [hero({ eyebrow: "SUBMAP TERRAIN", title: node.label, id: binding.path ?? binding.id, chips: [makeChip(statusLabel(node.status), statusTone(node.status)), makeChip("投影容器")] })];
    const bindingPath = binding.path ?? binding.id;
    const expanded = runtime.expandedSubmaps.has(bindingPath);
    const toggle = element("button", "submap-toggle", expanded ? "收缩子地图" : "展开子地图");
    toggle.type = "button";
    toggle.setAttribute("aria-expanded", String(expanded));
    toggle.setAttribute("aria-controls", submapContainerId(bindingPath));
    toggle.addEventListener("click", () => toggleSubmap(bindingPath));
    content.push(toggle, submapHistoryButton(bindingPath, binding.historical_frame));
    content.push(ledgerSection("父子合同", [
      labeledValue("父工作边", binding.parent_edge),
      labeledValue("子地图", `${binding.map_id}\n${binding.map_ref}`),
      labeledValue("到达与验收", `${ARRIVAL_LABELS[binding.actual_arrival] ?? binding.actual_arrival}\n${binding.acceptance_passed}/${binding.acceptance_total}`),
      labeledValue("回执", `${statusLabel(binding.receipt_status)} · ${binding.receipt_id ?? "尚无"}`, ["current", "pinned"].includes(binding.receipt_status) ? "good" : "warn"),
      labeledValue("来源", binding.source_error ?? statusLabel(binding.source_status), binding.source_status === "stale" ? "bad" : "good"),
    ]));
    dom.inspectorContent.replaceChildren(...content);
    return;
  }
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
  if (node.draft) {
    const questions = (runtime.model.questions ?? []).filter((question) => question.target?.id === node.id);
    const humanConfirmed = node.goal_regression?.human_confirmed;
    content.push(ledgerSection("候选说明", [
      labeledValue("正式状态", humanConfirmed ? "旧记录显示已审阅；仍须写入 Blueprint 并证明" : "候选链对象；尚未写入 Blueprint", "warn"),
      labeledValue("用途", node.purpose ?? "当前勘探候选"),
    ]));
    content.push(ledgerSection("收敛问题", questions.map((question) => labeledValue(
      question.id,
      `${question.prompt}\n目的：${question.target.purpose}\n${questionUpdateLabel(question)}`,
      question.status === "answered" ? "good" : "warn",
    )), "尚无问题明确指向这个候选节点。"));
  }
  content.push(ledgerSection("状态断言", node.predicates.map((predicate) => labeledValue(
    predicate.id,
    `期望 ${predicate.equals} · 当前 ${predicate.actual}\nFact: ${predicate.fact}\n证据:\n${evidenceRefs(predicate.evidence)}`,
    predicate.satisfied ? "good" : ["unknown", "conflict"].includes(predicate.actual) ? "bad" : "warn",
  ))));
  if (node.arrival_checkpoint_ids?.length) {
    content.push(ledgerSection("Arrival Checkpoint", node.arrival_checkpoint_ids.map((checkpointId) => labeledValue(
      checkpointId,
      runtime.model.arrival_checkpoints.find((checkpoint) => checkpoint.id === checkpointId)?.destination.statement ?? "历史到达",
      "good",
    ))));
  }
  if (node.goal_regression) {
    const section = element("section", "ledger-section regression-section");
    section.append(element("h3", "", "目标回归位置"), regressionStepItem(node.goal_regression));
    content.push(section);
  }
  content.push(ledgerSection("抵达这个状态的工作", incoming.map((edge) => labeledValue(
    edge.title,
    `${edge.id} · ${edgeExecutionLabel(edge, runtime.model)}`,
    edge.status === "verified" ? "good" : edge.status === "active" ? "warn" : "",
  )), "这是起始状态，或尚未声明产生它的工作边。"));
  content.push(ledgerSection("从这里出发的工作", outgoing.map((edge) => labeledValue(
    edge.title,
    `${edge.id} · ${edgeExecutionLabel(edge, runtime.model)}`,
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
      makeChip(edgeExecutionLabel(edge, runtime.model), statusTone(edge.status)),
      edge.proven ? makeChip("属于当前证明路线", "teal") : makeChip("不在当前剩余路线"),
      edge.candidate ? makeChip("当前候选", "amber") : makeChip(edge.status === "verified" ? "历史已完成" : "非当前候选"),
    ],
  })];
  if (edge.draft) {
    const questions = (runtime.model.questions ?? []).filter((question) => question.target?.id === edge.id);
    const humanConfirmed = edge.goal_regression?.[0]?.human_confirmed;
    content.push(ledgerSection("候选说明", [
      labeledValue("正式状态", humanConfirmed ? "旧记录显示已审阅；仍须写入 Blueprint 并证明" : "候选链对象；尚未写入 Blueprint", "warn"),
      labeledValue("用途", edge.purpose ?? "当前回归候选"),
    ]));
    content.push(ledgerSection("收敛问题", questions.map((question) => labeledValue(
      question.id,
      `${question.prompt}\n目的：${question.target.purpose}\n${questionUpdateLabel(question)}`,
      question.status === "answered" ? "good" : "warn",
    )), "尚无问题明确指向这条候选边。"));
    if (edge.proof) {
      content.push(ledgerSection("候选证明", [
        labeledValue("状态", edge.proof.status ?? "未开始"),
        labeledValue("说明", edge.proof.summary ?? "尚未提供可达性证明"),
        labeledValue("缺失", edge.proof.missing ?? "无"),
        labeledValue("证据引用", evidenceRefs(edge.proof.evidence_refs ?? [])),
      ]));
    }
  }
  const readinessLabel = edge.draft
    ? "仅候选；整体审阅并补齐合同后写入 Blueprint，通过 validate/prove 与 init/replan 再评估"
    : edge.ready
      ? edgeExecutionLabel(edge, runtime.model)
      : `尚缺：${asText(edge.missing)}`;
  content.push(ledgerSection("状态迁移", [
    labeledValue("从", edge.from),
    labeledValue("到", edge.to),
    labeledValue("执行门", readinessLabel, edge.draft || edge.ready ? "warn" : "bad"),
    labeledValue("失败分支", edge.on_failure),
  ]));
  const handoff = edge.brief?.metadata?.contract?.handoff;
  if (handoff) content.push(ledgerSection("岗位交接", [
    labeledValue("来自", handoff.from_roles),
    labeledValue("交给", handoff.to_roles),
    labeledValue("输入", handoff.inputs),
    labeledValue("输出", handoff.outputs),
    labeledValue("决策权", handoff.decision_rights),
  ]));
  const context = edge.brief?.metadata?.contract?.context;
  if (context) content.push(ledgerSection("上下文披露", [
    labeledValue("当前焦点", context.focus, "good"),
    labeledValue("先加载", context.load_first),
    labeledValue("按需加载", context.load_on_demand?.map((item) => `${item.when} → ${asText(item.refs)}`) ?? []),
    labeledValue("注意力预算", `${context.budget.max_files} files / ${context.budget.max_chars} chars`),
  ]));
  if (edge.goal_regression?.length) {
    content.push(ledgerSection("目标回归证明", edge.goal_regression.map((regression) => labeledValue(
      `第 ${regression.depth} 层 · ${regression.target_node}`,
      `目标侧后缀：${REGRESSION_LABELS[regression.suffix_proof.status] ?? regression.suffix_proof.status}\n当前事实前缀：${REGRESSION_LABELS[regression.prefix_reachability.status] ?? regression.prefix_reachability.status}\n桥接：${REGRESSION_LABELS[regression.bridge_status] ?? regression.bridge_status}\n登记：${regression.formal ? "已写入正式 Blueprint" : "仍为整体候选链的一部分"}`,
      regressionTone(regression.bridge_status),
    ))));
  }
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
  content.push(ledgerSection("施工授权", (edge.authorization_requests ?? []).map((request) => labeledValue(
    `${request.id} · ${request.status}`,
    `问题：${request.question}\n责任人：${decisionOwnerLabel(request)}\n请求者：${request.requested_by}${request.answer ? `\n回答：${request.answer}` : ""}${request.authorized_by ? `\n授权人：${request.authorized_by}` : ""}`,
    request.status === "granted" ? "good" : request.status === "pending" ? "warn" : "bad",
  )), "这条工作边尚未提出施工授权请求。"));
  content.push(ledgerSection("确定性能力", (edge.capabilities ?? []).map((capability) => labeledValue(
    `${capability.id} · ${capability.status}`,
    `Run：${capability.run}\nVerifier：${capability.verifier ?? "无"}\n允许动作：${asText(capability.allowed_actions)}\nBrief 边界：${asText(capability.brief_allowed_actions)}\n到期：${formatTimestamp(capability.expires_at)}\nToken：只保存 SHA-256，不在看板回显`,
    capability.status === "consumed" ? "good" : capability.status === "active" ? "warn" : "bad",
  )), "这条工作边尚未签发确定性能力。"));
  content.push(ledgerSection("Edge Run", (edge.runs ?? []).map((run) => labeledValue(
    `${run.id} · ${statusLabel(run.status)}`,
    `attempt ${run.attempt}\n施工授权：${run.authorization_request ?? "旧状态未记录"}\n开始：${formatTimestamp(run.started_at)}\n更新：${formatTimestamp(run.updated_at)}${run.blocking_reason ? `\n阻塞：${run.blocking_reason}` : ""}${run.waiting_reason ? `\n等待：${run.waiting_reason}` : ""}`,
    statusTone(run.status),
  )), "这条工作边尚未启动运行实例。"));
  content.push(ledgerSection("决策记录", (edge.decisions ?? []).map((decision) => labeledValue(
    decision.id,
    `选择：${decision.edge}\n备选：${asText(decision.alternatives)}\n理由：${decision.reason}\n决策者：${decision.actor}\n施工授权：${decision.authorization_request ?? "旧状态未记录"}`,
    "good",
  )), "这条工作边还没有路线选择记录。"));
  if (edge.submap) {
    const submapSection = element("section", "ledger-section");
    submapSection.append(element("h3", "", "子地图绑定"));
    const details = element("ul", "ledger-list");
    details.append(
      labeledValue("地图", `${edge.submap.map_id} · ${PHASE_LABELS[edge.submap.phase] ?? edge.submap.phase}`),
      labeledValue("到达", `${ARRIVAL_LABELS[edge.submap.actual_arrival] ?? edge.submap.actual_arrival} · 验收 ${edge.submap.acceptance_passed}/${edge.submap.acceptance_total}`),
      labeledValue("回执", `${statusLabel(edge.submap.receipt_status)} · ${edge.submap.receipt_id ?? "尚无"}`, ["current", "pinned"].includes(edge.submap.receipt_status) ? "good" : "warn"),
      labeledValue("导出合同", edge.submap.exports),
      labeledValue("来源", edge.submap.source_error ?? statusLabel(edge.submap.source_status), edge.submap.source_status === "stale" ? "bad" : "good"),
    );
    const bindingPath = edge.submap.path ?? edge.submap.id;
    const expanded = runtime.expandedSubmaps.has(bindingPath);
    const toggle = element("button", "submap-toggle", expanded ? "收缩子地图" : "展开子地图");
    toggle.type = "button";
    toggle.setAttribute("aria-expanded", String(expanded));
    toggle.setAttribute("aria-controls", submapContainerId(bindingPath));
    toggle.addEventListener("click", () => toggleSubmap(bindingPath));
    submapSection.append(details, toggle, submapHistoryButton(bindingPath, edge.submap.historical_frame));
    content.push(submapSection);
  }
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

  const briefContract = edge.brief.metadata?.contract ?? {};
  content.push(ledgerSection("范围与非目标", [
    labeledValue("范围内", briefContract.scope?.in ?? runtime.model.map.boundaries.in_scope),
    labeledValue("非目标", briefContract.scope?.out ?? briefContract.out_of_scope ?? edge.non_goals ?? runtime.model.map.boundaries.out_of_scope),
    labeledValue("授权", briefContract.authorization?.required ?? runtime.model.map.boundaries.authorization),
  ]));

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
    const eventName = timelineEventLabel(entry);
    const eventContext = entry.edge ?? entry.details?.edge;
    const eventTitle = eventContext ? `${eventName} · ${eventContext}` : eventName;
    const button = element("button", "timeline-event" + (["evidence", "receipt"].includes(entry.kind) ? " is-evidence" : ""));
    button.type = "button";
    button.append(element("strong", "", eventTitle), element("span", "", `${formatTimestamp(entry.at)} · ${entry.kind === "evidence" ? "凭据" : "状态"}`));
    button.addEventListener("click", () => {
      setInspectorOpen(true);
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
  if (model.projection.source_status === "empty") {
    dom.syncState.classList.remove("is-current", "is-stale");
    dom.syncState.textContent = "未建立";
    dom.sourceBanner.hidden = true;
    dom.freshness.textContent = `投影 ${formatTimestamp(model.projection.generated_at)} · 空白工作区`;
    return;
  }
  const stale = model.projection.source_status !== "current";
  dom.syncState.classList.toggle("is-current", !stale);
  dom.syncState.classList.toggle("is-stale", stale);
  dom.syncState.textContent = stale ? "使用最近有效版本" : "已同步";
  dom.sourceBanner.hidden = !stale;
  dom.sourceBanner.textContent = stale
    ? `真相源暂不可用，当前保留最近一次有效地图：${model.projection.source_error ?? "来源状态异常"}`
    : "";
  const modeLabel = model.projection.mode === "runtime" ? "运行态" : model.projection.mode === "wayfinding" ? "建模草稿" : "定义态";
  dom.freshness.textContent = `投影 ${formatTimestamp(model.projection.generated_at)} · ${modeLabel}`;
}

function renderCompositeModel(model) {
  if (!model) return;
  const nextTopology = topologySignature(model);
  const topologyChanged = nextTopology !== runtime.topology;
  const previousSelection = runtime.selected;
  runtime.model = model;
  runtime.topology = nextTopology;
  const wayfindingPhase = model.wayfinding?.phase ?? model.map.wayfinding_phase;
  document.body.dataset.journeyMode = model.projection.mode === "wayfinding" ? wayfindingPhase : model.projection.mode;

  if (model.projection.mode === "wayfinding") {
    dom.destination.textContent = humanDestinationTitle(model);
  } else {
    dom.destination.textContent = model.map.destination.statement;
  }
  dom.destinationContext.textContent = destinationContextText(model);
  document.title = `${humanDestinationTitle(model)} · Mapflow`;
  dom.phase.textContent = model.projection.mode === "wayfinding"
    ? WAYFINDING_PHASE_LABELS[model.wayfinding?.phase ?? model.map.wayfinding_phase] ?? "探路建模"
    : PHASE_LABELS[model.map.phase] ?? model.map.phase;
  dom.canvasEyebrow.textContent = canvasEyebrow(model);
  dom.reachability.textContent = REACHABILITY_LABELS[model.summary.reachability] ?? model.summary.reachability;
  dom.arrival.textContent = model.map.actual_arrival === "audited" && model.map.current_destination?.status === "drifted"
    ? "曾到达 · 当前已漂移"
    : model.map.actual_arrival !== "audited" && (model.summary.arrival_checkpoints ?? 0) > 0
      ? `历史到达 ${model.summary.arrival_checkpoints} · 当前航段未到达`
      : ARRIVAL_LABELS[model.map.actual_arrival] ?? model.map.actual_arrival;
  dom.revision.textContent = model.projection.revision.slice(0, 12);
  dom.revision.title = model.projection.revision;
  renderCurrentPosition(model);
  renderCurrentAction(model);
  renderGoalSummary(model);
  if (model.evolution?.historical) {
    dom.actionGate.dataset.state = "historical";
    dom.actionState.textContent = "历史态 · 只读";
    dom.actionAfter.textContent = "使用时间轴前后步，或回到实时态继续工作";
  }
  renderCounts(model);
  renderWayfindingChrome(model);
  renderTimeline(model);
  updateSourceState(model);

  syncGraph(model, topologyChanged);
  updateView();
  if (topologyChanged) {
    if (model.evolution?.historical && runtime.positionLedger.size) layoutEvolutionGraph();
    else layoutGraph();
  }

  if (previousSelection?.type === "element" && (
    model.nodes.some((item) => item.id === previousSelection.id) || model.edges.some((item) => item.id === previousSelection.id)
  )) selectMapElement(previousSelection.id);
  else if (previousSelection?.type === "timeline") {
    const timelineEntry = model.timeline.find((item) => item.id === previousSelection.id);
    if (!timelineEntry) selectOverview();
  } else selectOverview();
}

function renderModel(model) {
  const changedMap = runtime.rootModel?.map.id !== model.map.id;
  runtime.rootModel = model;
  if (changedMap) {
    runtime.childModels.clear();
    runtime.submapEtags.clear();
    restoreExpandedSubmaps();
  }
  renderCompositeModel(composeModel());
  refreshExpandedSubmaps();
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

function evolutionDiffText(diff) {
  if (!diff) return "当前真相持续刷新；选择历史帧查看变化。";
  const parts = [
    [diff.nodes?.added?.length, "新增节点"],
    [diff.nodes?.changed?.length, "变化节点"],
    [diff.nodes?.removed?.length, "退出节点"],
    [diff.edges?.added?.length, "新增边"],
    [diff.edges?.changed?.length, "变化边"],
    [diff.edges?.removed?.length, "退出边"],
    [diff.facts?.changed?.length, "Fact 变化"],
    [diff.evidence?.added?.length, "新增 Evidence"],
    [diff.acceptance?.changed?.length, "验收变化"],
  ].filter(([count]) => count).map(([count, label]) => `${label} ${count}`);
  return parts.length ? parts.join(" · ") : "本帧没有拓扑或状态语义变化。";
}

function stopEvolutionPlayback() {
  if (runtime.evolution.timer !== null) window.clearTimeout(runtime.evolution.timer);
  runtime.evolution.timer = null;
  runtime.evolution.playing = false;
  if (dom.evolutionPlay) {
    dom.evolutionPlay.textContent = "播放";
    dom.evolutionPlay.setAttribute("aria-pressed", "false");
  }
}

function evolutionApiBase() {
  const bindingPath = runtime.evolution.bindingPath;
  if (!bindingPath) return "/api/evolution";
  const encoded = bindingPath.split("/").map(encodeURIComponent).join("/");
  return `/api/submaps/${encoded}/evolution`;
}

async function enterSubmapHistory(bindingPath, pinnedFrame = null) {
  stopEvolutionPlayback();
  const state = runtime.evolution;
  const parent = {
    bindingPath: state.bindingPath,
    catalog: state.catalog,
    etag: state.etag,
    frame: state.frame,
    index: state.index,
    pendingLive: state.pendingLive,
    rootModel: runtime.rootModel,
    childModels: new Map(runtime.childModels),
    submapEtags: new Map(runtime.submapEtags),
    expandedSubmaps: new Set(runtime.expandedSubmaps),
  };
  state.stack.push(parent);
  state.bindingPath = bindingPath;
  state.catalog = null;
  state.etag = null;
  state.frame = null;
  state.index = null;
  state.pendingLive = false;
  runtime.childModels.clear();
  runtime.submapEtags.clear();
  runtime.expandedSubmaps.clear();
  try {
    await pollEvolutionCatalog();
    const frames = state.catalog?.frames ?? [];
    if (!frames.length) throw new Error("这张子地图尚无可信演化帧");
    const pinnedIndex = pinnedFrame ? frames.findIndex((frame) => frame.id === pinnedFrame) : -1;
    if (pinnedFrame && pinnedIndex < 0) throw new Error(`回执固定帧不存在：${pinnedFrame}`);
    await showEvolutionFrame(pinnedIndex >= 0 ? pinnedIndex : frames.length - 1);
  } catch (error) {
    state.stack.pop();
    Object.assign(state, {
      bindingPath: parent.bindingPath,
      catalog: parent.catalog,
      etag: parent.etag,
      frame: parent.frame,
      index: parent.index,
      pendingLive: parent.pendingLive,
    });
    runtime.rootModel = parent.rootModel;
    runtime.childModels = parent.childModels;
    runtime.submapEtags = parent.submapEtags;
    runtime.expandedSubmaps = parent.expandedSubmaps;
    renderCompositeModel(composeModel());
    renderEvolutionPlayer();
    throw error;
  }
}

function returnToParentEvolution() {
  stopEvolutionPlayback();
  const parent = runtime.evolution.stack.pop();
  if (!parent) return;
  Object.assign(runtime.evolution, {
    bindingPath: parent.bindingPath,
    catalog: parent.catalog,
    etag: parent.etag,
    frame: parent.frame,
    index: parent.index,
    pendingLive: parent.pendingLive,
  });
  runtime.rootModel = parent.rootModel;
  runtime.childModels = parent.childModels;
  runtime.submapEtags = parent.submapEtags;
  runtime.expandedSubmaps = parent.expandedSubmaps;
  renderCompositeModel(composeModel());
  renderEvolutionPlayer();
  dom.announcer.textContent = runtime.evolution.bindingPath ? `已返回子地图 ${runtime.evolution.bindingPath}` : "已返回主地图";
}

function renderEvolutionPlayer() {
  const state = runtime.evolution;
  const catalog = state.catalog;
  if (!dom.evolutionPlayer) return;
  const historical = state.index !== null;
  const total = catalog?.frames?.length ?? 0;
  const frame = historical ? catalog?.frames?.[state.index] : null;
  const streamSegments = state.bindingPath?.split("/") ?? [];
  dom.evolutionBreadcrumb.textContent = ["主地图", ...streamSegments].join(" / ");
  dom.evolutionParent.hidden = state.stack.length === 0;
  dom.evolutionPlayer.classList.toggle("is-historical", historical);
  dom.evolutionPlayer.classList.toggle("has-live-update", state.pendingLive);
  dom.evolutionMode.classList.toggle("is-live", !historical && !state.pendingLive);
  dom.evolutionMode.classList.toggle("is-history", historical && !state.pendingLive);
  dom.evolutionMode.classList.toggle("has-update", state.pendingLive);
  dom.evolutionMode.textContent = state.pendingLive
    ? `历史态 · 有 ${Math.max(1, total - (state.index ?? total - 1) - 1)} 个新帧`
    : historical ? "历史态 · 只读" : "实时态";

  const coverage = catalog?.coverage;
  dom.evolutionCoverage.classList.toggle("is-partial", Boolean(coverage && !coverage.complete && catalog?.recording_status !== "stale"));
  dom.evolutionCoverage.classList.toggle("is-stale", catalog?.recording_status === "stale");
  dom.evolutionCoverage.textContent = catalog?.recording_status === "stale"
    ? `演化记录损坏：${catalog.error}`
    : coverage?.complete
      ? "完整覆盖 · 从空白开始"
      : `部分覆盖 · ${coverage?.reason ?? "此前过程未记录"}`;

  dom.evolutionSlider.disabled = total === 0;
  dom.evolutionSlider.max = String(Math.max(0, total - 1));
  dom.evolutionSlider.value = String(historical ? state.index : Math.max(0, total - 1));
  dom.evolutionSlider.setAttribute("aria-valuetext", frame
    ? `第 ${state.index + 1} 帧，共 ${total} 帧：${frame.summary}`
    : total ? `实时态；已记录 ${total} 帧` : "尚无可回放帧");
  dom.evolutionFirst.disabled = total === 0 || state.index === 0;
  dom.evolutionPrevious.disabled = total === 0 || state.index === 0;
  dom.evolutionNext.disabled = total === 0 || state.index === null || state.index >= total - 1;
  dom.evolutionLive.disabled = !historical && !state.pendingLive;
  dom.evolutionPlay.disabled = total < 2;

  if (historical && state.frame) {
    const event = state.frame.event;
    dom.evolutionCounter.textContent = `${state.index + 1} / ${total}`;
    dom.evolutionSummary.textContent = event.summary;
    dom.evolutionMeta.textContent = `${formatTimestamp(event.at)} · ${event.actor} · ${event.subject}`;
    dom.evolutionDiff.textContent = evolutionDiffText(state.frame.diff);
    dom.sourceBanner.classList.add("is-history");
    dom.sourceBanner.hidden = false;
    dom.sourceBanner.textContent = `${state.pendingLive ? "当前真相已有更新。" : ""}正在查看历史帧 ${state.index + 1}/${total}：${event.summary}。此画面只读，不会成为执行依据。`;
  } else {
    dom.evolutionCounter.textContent = "实时";
    dom.evolutionSummary.textContent = state.pendingLive ? "当前真相已有更新" : "当前真相持续刷新";
    dom.evolutionMeta.textContent = total ? `已记录 ${total} 个可信帧；历史回放不会写入 Sidecar` : "此地图尚无可回放演化记录";
    dom.evolutionDiff.textContent = "选择任一历史帧查看节点、边、Fact、Evidence 与验收的变化。";
    dom.sourceBanner.classList.remove("is-history");
  }
}

async function pollEvolutionCatalog() {
  const headers = runtime.evolution.etag ? { "If-None-Match": runtime.evolution.etag } : {};
  const response = await fetch(evolutionApiBase(), { headers, cache: "no-store" });
  if (response.status === 304) {
    renderEvolutionPlayer();
    return;
  }
  const catalog = await response.json();
  if (!response.ok) throw new Error(catalog.error ?? `HTTP ${response.status}`);
  const previousTotal = runtime.evolution.catalog?.frames?.length ?? 0;
  runtime.evolution.catalog = catalog;
  runtime.evolution.etag = response.headers.get("ETag");
  if (runtime.evolution.index !== null && catalog.frames.length > previousTotal) runtime.evolution.pendingLive = true;
  renderEvolutionPlayer();
}

async function showEvolutionFrame(index) {
  const frames = runtime.evolution.catalog?.frames ?? [];
  if (!frames.length) return;
  const bounded = Math.max(0, Math.min(index, frames.length - 1));
  const response = await fetch(`${evolutionApiBase()}/frames/${frames[bounded].id}`, { cache: "no-store" });
  const frame = await response.json();
  if (!response.ok) throw new Error(frame.error ?? `HTTP ${response.status}`);
  runtime.evolution.index = bounded;
  runtime.evolution.frame = frame;
  runtime.evolution.pendingLive = bounded < frames.length - 1;
  runtime.childModels.clear();
  runtime.submapEtags.clear();
  runtime.expandedSubmaps.clear();
  renderModel(frame.board);
  renderEvolutionPlayer();
  dom.announcer.textContent = `历史帧 ${bounded + 1}/${frames.length}：${frame.event.summary}`;
}

function returnToLive() {
  stopEvolutionPlayback();
  runtime.evolution.bindingPath = null;
  runtime.evolution.stack = [];
  runtime.evolution.catalog = null;
  runtime.evolution.etag = null;
  runtime.evolution.index = null;
  runtime.evolution.frame = null;
  runtime.evolution.pendingLive = false;
  runtime.childModels.clear();
  runtime.submapEtags.clear();
  restoreExpandedSubmaps();
  if (runtime.liveModel) renderModel(runtime.liveModel);
  renderEvolutionPlayer();
  pollEvolutionCatalog().catch((error) => showFetchError(error.message));
  dom.announcer.textContent = "已回到实时地图";
}

function scheduleEvolutionPlayback() {
  stopEvolutionPlayback();
  const total = runtime.evolution.catalog?.frames?.length ?? 0;
  if (total < 2) return;
  runtime.evolution.playing = true;
  dom.evolutionPlay.textContent = "暂停";
  dom.evolutionPlay.setAttribute("aria-pressed", "true");
  const tick = async () => {
    if (!runtime.evolution.playing || document.hidden) {
      stopEvolutionPlayback();
      return;
    }
    const next = runtime.evolution.index === null ? 0 : runtime.evolution.index + 1;
    if (next >= total) {
      stopEvolutionPlayback();
      return;
    }
    try {
      await showEvolutionFrame(next);
      runtime.evolution.playing = true;
      dom.evolutionPlay.textContent = "暂停";
      dom.evolutionPlay.setAttribute("aria-pressed", "true");
      runtime.evolution.timer = window.setTimeout(tick, Number(dom.evolutionSpeed.value));
    } catch (error) {
      stopEvolutionPlayback();
      showFetchError(error.message);
    }
  };
  tick();
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
      if (runtime.evolution.index === null && runtime.model) updateSourceState(runtime.model);
      if (runtime.evolution.index === null) await refreshExpandedSubmaps();
    } else {
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`);
      runtime.etag = response.headers.get("ETag");
      runtime.liveModel = body;
      if (runtime.evolution.index === null) {
        renderModel(body);
        dom.announcer.textContent = `地图已刷新，版本 ${body.projection.revision.slice(0, 8)}`;
      } else if (!runtime.evolution.bindingPath && runtime.rootModel?.projection.revision !== body.projection.revision) {
        runtime.evolution.pendingLive = true;
      }
    }
    await pollEvolutionCatalog();
  } catch (error) {
    showFetchError(error.name === "AbortError" ? "读取超时" : error.message);
  } finally {
    window.clearTimeout(timeout);
    runtime.pollTimer = window.setTimeout(pollBoard, POLL_INTERVAL_MS);
  }
}

function connectBoardStream() {
  if (typeof EventSource === "undefined" || runtime.stream) return;
  const stream = new EventSource("/api/stream");
  runtime.stream = stream;
  stream.addEventListener("revision", (event) => {
    try {
      JSON.parse(event.data);
    } catch {
      // Notifications never become truth; the API readback below remains authoritative.
    }
    pollBoard();
  });
  stream.addEventListener("open", () => {
    if (runtime.model?.projection?.source_status === "current") dom.syncState.textContent = "实时连接";
  });
  stream.addEventListener("error", () => {
    if (runtime.model) dom.syncState.textContent = "重连中 · 轮询兜底";
  });
}

function bindControls() {
  dom.confirmDestination.addEventListener("click", () => submitWayfindingChoice("confirm"));
  dom.adjustDestination.addEventListener("click", () => {
    dom.adjustmentForm.hidden = false;
    dom.adjustment.focus();
  });
  dom.adjustmentCancel.addEventListener("click", () => {
    dom.adjustmentForm.hidden = true;
    dom.adjustment.value = "";
    setWayfindingResponseStatus();
  });
  dom.adjustmentForm.addEventListener("submit", (event) => {
    event.preventDefault();
    submitWayfindingChoice("adjust", dom.adjustment.value);
  });
  dom.lensButtons.forEach((button) => button.addEventListener("click", () => setLens(button.dataset.lens)));
  dom.inspectorToggle.addEventListener("click", () => setInspectorOpen(dom.inspector.hidden));
  dom.search.addEventListener("input", () => {
    runtime.query = dom.search.value;
    updateView();
  });
  dom.fit.addEventListener("click", fitGraph);
  dom.relayout.addEventListener("click", layoutGraph);
  dom.evolutionFirst.addEventListener("click", () => showEvolutionFrame(0).catch((error) => showFetchError(error.message)));
  dom.evolutionPrevious.addEventListener("click", () => {
    const index = runtime.evolution.index ?? (runtime.evolution.catalog?.frames?.length ?? 1);
    showEvolutionFrame(index - 1).catch((error) => showFetchError(error.message));
  });
  dom.evolutionNext.addEventListener("click", () => {
    if (runtime.evolution.index === null) return;
    showEvolutionFrame(runtime.evolution.index + 1).catch((error) => showFetchError(error.message));
  });
  dom.evolutionParent.addEventListener("click", returnToParentEvolution);
  dom.evolutionLive.addEventListener("click", returnToLive);
  dom.evolutionPlay.addEventListener("click", () => {
    if (runtime.evolution.playing) stopEvolutionPlayback();
    else scheduleEvolutionPlayback();
  });
  dom.evolutionSlider.addEventListener("input", () => {
    stopEvolutionPlayback();
    showEvolutionFrame(Number(dom.evolutionSlider.value)).catch((error) => showFetchError(error.message));
  });
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
    if (document.hidden) stopEvolutionPlayback();
    startTrailAnimation();
    if (!document.hidden) pollBoard();
  });
  window.matchMedia("(prefers-reduced-motion: reduce)").addEventListener?.("change", startTrailAnimation);
}

function bootstrap() {
  bindControls();
  dom.inspectorContent.replaceChildren(element("p", "empty-note", "正在读取 Blueprint、运行状态和实施凭据…"));
  connectBoardStream();
  pollBoard();
}

if (typeof document !== "undefined") bootstrap();
