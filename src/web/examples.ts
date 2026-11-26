import type { Language } from '../core/types.js';

export interface CodeExample {
  id: string;
  title: string;
  subtitle: string;
  language: Language;
  fileName: string;
  code: string;
  refactoredFileName?: string;
  refactoredCode?: string;
}

export const EXAMPLES: CodeExample[] = [
  {
    id: 'checkout-ts',
    title: 'Spaghetti Order Checkout (TS)',
    subtitle: '10+ live slots, shadowing, mutable closure capture, long eye-jumps',
    language: 'typescript',
    fileName: 'checkout-legacy.ts',
    code: `interface CartItem {
  sku: string;
  price: number;
  qty: number;
  category: string;
  taxExempt?: boolean;
}

interface CheckoutContext {
  items: CartItem[];
  couponCode: string;
  loyaltyPoints: number;
  regionTaxRate: number;
  isVip: boolean;
  expressShipping: boolean;
}

export function processOrderCheckout(ctx: CheckoutContext) {
  const { items, couponCode, loyaltyPoints, regionTaxRate, isVip, expressShipping } = ctx;
  let subtotal = 0;
  let discount = 0;
  let taxTotal = 0;
  let shippingFee = expressShipping ? 19.99 : 6.99;
  const warnings: string[] = [];
  const auditTrail: string[] = [];

  if (items.length === 0) {
    return { total: 0, warnings: ['Empty cart'] };
  }

  for (const item of items) {
    if (item.qty <= 0) {
      warnings.push(\`Skipped invalid qty for \${item.sku}\`);
      continue;
    }
    const lineAmount = item.price * item.qty;
    subtotal += lineAmount;

    if (item.category === 'clearance') {
      const discount = lineAmount * 0.15;
      subtotal -= discount;
      auditTrail.push(\`clearance:\${item.sku}:-\${discount.toFixed(2)}\`);
    }

    if (!item.taxExempt) {
      taxTotal += lineAmount * regionTaxRate;
    }
  }

  if (couponCode.startsWith('SAVE')) {
    const rawPct = Number(couponCode.slice(4)) || 10;
    discount += subtotal * Math.min(rawPct, 35) / 100;
    auditTrail.push(\`coupon:\${couponCode}\`);
  }

  if (isVip) {
    discount += subtotal * 0.05;
    if (subtotal > 100) {
      shippingFee = 0;
    }
  }

  // Mutable closure captures outer discount, loyaltyPoints & auditTrail
  const bonusTiers = [500, 1000, 2500];
  bonusTiers.forEach((tier) => {
    if (loyaltyPoints >= tier) {
      discount += 5;
      auditTrail.push(\`tier:\${tier}\`);
    }
  });

  if (discount > subtotal * 0.5) {
    discount = subtotal * 0.5;
    warnings.push('Discount capped at 50% of subtotal');
  }

  const grandTotal = Math.max(0, subtotal - discount + taxTotal + shippingFee);
  return {
    subtotal,
    discount,
    taxTotal,
    shippingFee,
    grandTotal,
    warnings,
    auditTrail
  };
}`,
    refactoredFileName: 'checkout-pipeline.ts',
    refactoredCode: `interface CartItem {
  sku: string;
  price: number;
  qty: number;
  category: string;
  taxExempt?: boolean;
}

interface CheckoutContext {
  items: CartItem[];
  couponCode: string;
  loyaltyPoints: number;
  regionTaxRate: number;
  isVip: boolean;
  expressShipping: boolean;
}

function summarizeCartLines(items: CartItem[], taxRate: number) {
  const valid = items.filter((line) => line.qty > 0);
  const warnings = items
    .filter((line) => line.qty <= 0)
    .map((line) => \`Skipped invalid qty for \${line.sku}\`);

  const subtotal = valid.reduce((acc, line) => {
    const gross = line.price * line.qty;
    return acc + (line.category === 'clearance' ? gross * 0.85 : gross);
  }, 0);

  const taxTotal = valid.reduce((acc, line) => {
    return line.taxExempt ? acc : acc + line.price * line.qty * taxRate;
  }, 0);

  return { subtotal, taxTotal, warnings };
}

function computeLoyaltyBonus(loyaltyPoints: number): number {
  const tiers = [500, 1000, 2500];
  return tiers.filter((tier) => loyaltyPoints >= tier).length * 5;
}

function computeDiscount(subtotal: number, ctx: CheckoutContext): number {
  const couponPct = ctx.couponCode.startsWith('SAVE')
    ? Math.min(Number(ctx.couponCode.slice(4)) || 10, 35) / 100
    : 0;
  const vipPct = ctx.isVip ? 0.05 : 0;
  const raw = subtotal * (couponPct + vipPct) + computeLoyaltyBonus(ctx.loyaltyPoints);
  return Math.min(raw, subtotal * 0.5);
}

function computeShipping(subtotal: number, isVip: boolean, express: boolean): number {
  if (isVip && subtotal > 100) return 0;
  return express ? 19.99 : 6.99;
}

export function processOrderCheckout(ctx: CheckoutContext) {
  if (ctx.items.length === 0) {
    return { total: 0, warnings: ['Empty cart'] };
  }
  const { subtotal, taxTotal, warnings } = summarizeCartLines(ctx.items, ctx.regionTaxRate);
  const discount = computeDiscount(subtotal, ctx);
  const shippingFee = computeShipping(subtotal, ctx.isVip, ctx.expressShipping);
  const grandTotal = Math.max(0, subtotal - discount + taxTotal + shippingFee);
  return { subtotal, discount, taxTotal, shippingFee, grandTotal, warnings };
}`
  },
  {
    id: 'python-log-parser',
    title: 'Deep Nested Python Log Parser (PY)',
    subtitle: 'Deep indentation, nonlocal closure capture, comprehension shadowing',
    language: 'python',
    fileName: 'log_parser_legacy.py',
    code: `def analyze_incident_logs(raw_lines, service_filter, min_latency, max_errors):
    error_count = 0
    slow_count = 0
    total_latency = 0.0
    affected_users = set()
    alerts = []
    skipped = 0
    window_tag = "default"

    def record_alert(code, detail):
        nonlocal error_count
        error_count += 1
        alerts.append(f"[{window_tag}] {code}: {detail}")

    for line in raw_lines:
        clean = line.strip()
        if not clean or clean.startswith("#"):
            skipped += 1
            continue

        parts = clean.split("|")
        if len(parts) < 5:
            skipped += 1
            continue

        svc, level, user_id, latency_raw, msg = parts[:5]
        if service_filter and svc != service_filter:
            continue

        try:
            latency = float(latency_raw)
            total_latency += latency
            if latency >= min_latency:
                slow_count += 1
                if level == "ERROR":
                    affected_users.add(user_id)
                    record_alert("SLOW_ERR", f"{svc}:{msg}")
                    if error_count >= max_errors:
                        alerts.append("CIRCUIT_BREAKER_TRIPPED")
                        break
        except ValueError as err:
            record_alert("PARSE_FAIL", str(err))
            continue

    # Comprehension shadows outer \`line\` identifier
    critical_tags = [line.upper() for line in alerts if "SLOW_ERR" in line]
    avg_latency = total_latency / max(1, len(raw_lines) - skipped)

    return {
        "errors": error_count,
        "slow": slow_count,
        "avg_latency": avg_latency,
        "users": sorted(affected_users),
        "critical": critical_tags,
        "skipped": skipped,
    }`,
    refactoredFileName: 'log_parser_clean.py',
    refactoredCode: `def parse_log_entry(raw_line):
    clean = raw_line.strip()
    if not clean or clean.startswith("#"):
        return None
    parts = clean.split("|")
    if len(parts) < 5:
        return None
    try:
        latency = float(parts[3])
    except ValueError:
        return {"parse_error": parts[3]}
    return {
        "service": parts[0],
        "level": parts[1],
        "user_id": parts[2],
        "latency": latency,
        "msg": parts[4],
    }


def filter_entries(raw_lines, service_filter):
    parsed = [parse_log_entry(row) for row in raw_lines]
    valid = [entry for entry in parsed if entry is not None]
    if not service_filter:
        return valid
    return [e for e in valid if e.get("parse_error") or e["service"] == service_filter]


def analyze_incident_logs(raw_lines, service_filter, min_latency, max_errors):
    entries = filter_entries(raw_lines, service_filter)
    slow = [e for e in entries if not e.get("parse_error") and e["latency"] >= min_latency]
    errors = [e for e in slow if e["level"] == "ERROR"][:max_errors]
    avg_latency = sum(e.get("latency", 0.0) for e in entries) / max(1, len(entries))
    return {
        "errors": len(errors),
        "slow": len(slow),
        "avg_latency": avg_latency,
        "users": sorted({e["user_id"] for e in errors}),
    }`
  },
  {
    id: 'inventory-sync-js',
    title: 'Mutation-Heavy Inventory Sync (JS)',
    subtitle: 'In-place Map/Array mutations, multi-pass state drift, destructuring',
    language: 'javascript',
    fileName: 'inventory-sync.js',
    code: `export function reconcileWarehouseStock(snapshot, incomingEvents, safetyBuffer) {
  const stockMap = new Map();
  const restockQueue = [];
  const anomalies = [];
  let processed = 0;
  let totalDelta = 0;
  let reservedUnits = 0;
  let overflowCount = 0;

  for (const { sku, onHand, reserved } of snapshot) {
    stockMap.set(sku, onHand - reserved);
    reservedUnits += reserved;
  }

  for (const event of incomingEvents) {
    const { sku, delta, reason, priority } = event;
    if (!stockMap.has(sku)) {
      anomalies.push({ sku, issue: 'UNKNOWN_SKU' });
      continue;
    }

    let current = stockMap.get(sku);
    current += delta;
    totalDelta += delta;
    processed++;

    if (current < 0) {
      anomalies.push({ sku, issue: 'NEGATIVE_STOCK', reason });
      current = 0;
      overflowCount++;
    }

    stockMap.set(sku, current);

    if (current < safetyBuffer) {
      const deficit = safetyBuffer - current;
      restockQueue.push({ sku, deficit, priority: priority || 'normal' });
    }

    if (anomalies.length > 25) {
      break;
    }
  }

  restockQueue.sort((a, b) => b.deficit - a.deficit);

  return {
    stockMap,
    restockQueue,
    anomalies,
    processed,
    totalDelta,
    reservedUnits,
    overflowCount
  };
}`,
    refactoredFileName: 'inventory-sync-clean.js',
    refactoredCode: `function buildAvailableIndex(snapshot) {
  const index = new Map();
  for (const { sku, onHand, reserved } of snapshot) {
    index.set(sku, onHand - reserved);
  }
  return index;
}

function applyStockEvent(stockMap, event) {
  const { sku, delta, reason } = event;
  if (!stockMap.has(sku)) {
    return { anomaly: { sku, issue: 'UNKNOWN_SKU' }, nextQty: null };
  }
  const raw = stockMap.get(sku) + delta;
  if (raw < 0) {
    return { anomaly: { sku, issue: 'NEGATIVE_STOCK', reason }, nextQty: 0 };
  }
  return { anomaly: null, nextQty: raw };
}

function buildRestockQueue(stockMap, safetyBuffer) {
  const queue = [];
  for (const [sku, qty] of stockMap.entries()) {
    if (qty < safetyBuffer) {
      queue.push({ sku, deficit: safetyBuffer - qty });
    }
  }
  return queue.sort((a, b) => b.deficit - a.deficit);
}

export function reconcileWarehouseStock(snapshot, incomingEvents, safetyBuffer) {
  const stockMap = buildAvailableIndex(snapshot);
  const anomalies = [];
  for (const event of incomingEvents) {
    const outcome = applyStockEvent(stockMap, event);
    if (outcome.anomaly) anomalies.push(outcome.anomaly);
    if (outcome.nextQty !== null) stockMap.set(event.sku, outcome.nextQty);
    if (anomalies.length > 25) break;
  }
  const restockQueue = buildRestockQueue(stockMap, safetyBuffer);
  return { stockMap, restockQueue, anomalies };
}`
  },
  {
    id: 'closure-cache-ts',
    title: 'Async Closure Cache & Retry (TS)',
    subtitle: 'Cross-boundary closure captures, shadowing, try/catch control flow',
    language: 'typescript',
    fileName: 'retry-cache.ts',
    code: `interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

export function createRetryFetcher<T>(
  fetcher: (key: string) => Promise<T>,
  ttlMs: number,
  maxAttempts: number
) {
  const store = new Map<string, CacheEntry<T>>();
  const inflight = new Map<string, Promise<T>>();
  let hits = 0;
  let misses = 0;
  let failures = 0;

  return async function fetchWithRetry(key: string): Promise<T> {
    const now = Date.now();
    const cached = store.get(key);
    if (cached && cached.expiresAt > now) {
      hits++;
      return cached.value;
    }

    const pending = inflight.get(key);
    if (pending) {
      return pending;
    }

    misses++;
    const run = (async () => {
      let attempt = 0;
      let lastError: unknown = null;

      while (attempt < maxAttempts) {
        attempt++;
        try {
          const result = await fetcher(key);
          const entry: CacheEntry<T> = { value: result, expiresAt: Date.now() + ttlMs };
          store.set(key, entry);
          return result;
        } catch (err) {
          failures++;
          lastError = err;
          if (attempt >= maxAttempts) {
            throw lastError;
          }
          // Shadowed \`key\` inside backoff logger
          const key = \`retry:\${attempt}:\${failures}\`;
          await new Promise((resolve) => setTimeout(resolve, attempt * 100, key));
        }
      }
      throw lastError;
    })();

    inflight.set(key, run);
    try {
      return await run;
    } finally {
      inflight.delete(key);
    }
  };
}`
  }
];
