import { loadArtifact } from './textbook-runtime.js';

export function validateParsed(pack) {
  const errors = [];
  const warnings = [];
  const error = message => errors.push(message);
  for (const key of ['source', 'metadata', 'topics_with_pages', 'rules', 'example_tasks_v2', 'generator_profile_kz_moem']) {
    if (pack[key] == null) error(`Missing ${key}`);
  }
  if (!['v2', 'v3'].includes(pack.source?.version)) error('source.version must be v2 or v3');
  const topics = Array.isArray(pack.topics_with_pages) ? pack.topics_with_pages : [];
  if (!Array.isArray(pack.topics_with_pages)) error('topics_with_pages must be an array');
  if (!Array.isArray(pack.rules)) error('rules must be an array');
  const ids = new Set();
  for (const topic of topics) {
    if (topic.id != null) {
      if (ids.has(String(topic.id))) error(`Duplicate topic id ${topic.id}`);
      ids.add(String(topic.id));
    }
    if (!(topic.topic_title || topic.topic_title_kk)) error('Topic has no title');
    if (topic.page_start != null && (!Number.isInteger(topic.page_start) || topic.page_start < 1)) error(`Invalid topic page: ${topic.id}`);
    if (topic.page_end_estimated != null && (!Number.isInteger(topic.page_end_estimated) || topic.page_end_estimated < topic.page_start)) error(`Invalid topic range: ${topic.id}`);
    const s = topic.full_text_status;
    if (s?.available && (typeof topic.full_text !== 'string' || !topic.full_text.trim())) error(`Available full_text is empty: ${topic.id}`);
    if (s?.chars != null && s.chars !== (topic.full_text?.length ?? 0)) error(`full_text chars mismatch: ${topic.id}`);
    if (s?.truncated) warnings.push(`Truncated topic: ${topic.id}`);
  }
  for (const topic of topics) if (topic.parent_id != null && !ids.has(String(topic.parent_id))) error(`Unknown parent ${topic.parent_id}`);
  const parents = new Map(topics.map(t => [String(t.id), t.parent_id == null ? null : String(t.parent_id)]));
  for (const topic of topics) {
    const seen = new Set();
    let id = String(topic.id);
    while (id != null && parents.has(id)) {
      if (seen.has(id)) { error(`Cyclic topic hierarchy: ${topic.id}`); break; }
      seen.add(id); id = parents.get(id);
    }
  }
  const taskIds = new Set();
  const signatures = new Set();
  for (const task of pack.example_tasks_v2?.textbook_tasks || []) {
    if (!task.task_id || taskIds.has(task.task_id)) error(`Missing/duplicate task id: ${task.task_id}`);
    taskIds.add(task.task_id);
    if (!task.question_text?.trim()) error(`Empty task: ${task.task_id}`);
    if (task.topic_ref != null && ids.size && !ids.has(String(task.topic_ref))) error(`Unknown topic_ref: ${task.task_id}`);
    if (task.page != null && (!Number.isInteger(task.page) || task.page < 1)) error(`Invalid task page: ${task.task_id}`);
    const signature = JSON.stringify([task.page, task.topic_ref, task.question_text?.replace(/\s+/g, ' ').trim()]);
    if (signatures.has(signature)) warnings.push(`Possible duplicate task at same source: ${task.task_id}`);
    signatures.add(signature);
  }
  const taskStatus = pack.example_tasks_v2?.textbook_tasks_status;
  if (taskStatus?.count != null && taskStatus.count !== (pack.example_tasks_v2.textbook_tasks || []).length) error('textbook_tasks_status.count mismatch');
  for (const example of pack.example_tasks_v2?.structural_examples_for_generation || []) {
    if (!Object.hasOwn(example, 'source_page')) error('Structural example missing source_page');
  }
  return { valid: errors.length === 0, errors, warnings, counts: { topics: topics.length,
    rules: Array.isArray(pack.rules) ? pack.rules.length : 0, tasks: taskIds.size } };
}
export function assemble(index, plan) {
  if (plan.pdfSha256 !== index.pdfSha256) throw Error('Plan belongs to a different PDF.');
  if (!index.mapping) throw Error('Save verified printed-page offset first with --set-offset and --mapping-evidence.');
  const artifacts = new Map(index.pages.map(entry => [entry.pdfPage, { entry, data: loadArtifact(entry) }]));
  for (const correction of plan.text_corrections || []) {
    const block = artifacts.get(correction.pdf_page)?.data.blocks.find(b => b.id === correction.block_id);
    if (!block || block.text !== correction.original_text) throw Error(`Correction original does not match ${correction.block_id}`);
    if (!correction.evidence?.trim() || typeof correction.corrected_text !== 'string' || !correction.corrected_text.trim()) throw Error('OCR correction needs corrected_text and visual evidence.');
    block.text = correction.corrected_text;
  }
  const consumed = new Set();
  function expandRefs(refs = []) {
    return refs.flatMap(ref => {
      if (ref.block_id) {
        if (ref.from_block || ref.to_block) throw Error('Use block_id OR from_block/to_block, not both.');
        return [ref];
      }
      const blocks = artifacts.get(ref.pdf_page)?.data.blocks || [];
      const first = blocks.findIndex(b => b.id === ref.from_block);
      const last = blocks.findIndex(b => b.id === ref.to_block);
      if (first < 0 || last < first || ref.start != null || ref.end != null) throw Error('Invalid block range; use existing from_block/to_block in reading order.');
      return blocks.slice(first, last + 1).map(b => ({ ...ref, block_id: b.id, from_block: undefined, to_block: undefined }));
    });
  }
  const verified = new Set(expandRefs(plan.verified_block_refs).map(ref => `${ref.pdf_page}:${ref.block_id}`));
  const bookPage = pdfPage => pdfPage - index.mapping.offset;
  function resolve(ref, consume = true) {
    const artifact = artifacts.get(ref.pdf_page);
    const block = artifact?.data.blocks.find(b => b.id === ref.block_id);
    if (!block) throw Error(`Unknown block ${ref.pdf_page}:${ref.block_id}`);
    const start = ref.start ?? 0;
    const end = ref.end ?? block.text.length;
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end > block.text.length || end <= start) throw Error(`Invalid text span: ${ref.block_id}`);
    if (consume && (start !== 0 || end !== block.text.length)) {
      // Partial selections cannot silently count the remainder as covered.
      consumed.add(`${ref.pdf_page}:${ref.block_id}:${start}:${end}`);
    } else if (consume) consumed.add(`${ref.pdf_page}:${ref.block_id}`);
    return block.text.slice(start, end);
  }
  for (const ref of expandRefs(plan.verified_block_refs)) {
    resolve(ref, false);
    if (!ref.evidence?.trim()) throw Error('Verified blocks need visual evidence, not only a confidence assertion.');
  }
  const textOf = refs => expandRefs(refs).map(ref => resolve(ref)).join('\n');
  const verifiedRefs = refs => Boolean(refs?.length) && expandRefs(refs).every(ref => verified.has(`${ref.pdf_page}:${ref.block_id}`));
  const topics = (plan.topics_with_pages || []).map(topic => {
    const { block_refs = [], ...fields } = topic;
    const text = textOf(block_refs);
    const sourcePages = [...new Set(block_refs.map(ref => bookPage(ref.pdf_page)))];
    return { ...fields, full_text: text || null, confidence: verifiedRefs(block_refs) ? 'high' : 'medium',
      source_block_refs: block_refs, full_text_status: { available: Boolean(text), truncated: false, chars: text.length,
        source_pages: sourcePages, verified: verifiedRefs(block_refs), reason: text ? '' : (topic.reason || 'No readable content selected'),
        next_step: verifiedRefs(block_refs) ? '' : 'Review source PNG for uncertain or critical content.' } };
  });
  const rules = (plan.rules || []).map(rule => {
    const { block_refs = [], ...fields } = rule;
    if (!block_refs.length) throw Error(`Rule ${rule.rule_id} needs block_refs; reconstruction must stay outside verbatim export.`);
    return { ...fields, statement: textOf(block_refs), source_page: bookPage(block_refs[0].pdf_page),
      source_pages: [...new Set(block_refs.map(ref => bookPage(ref.pdf_page)))], source_block_refs: block_refs,
      confidence: verifiedRefs(block_refs) ? 'high' : 'medium', needs_manual_check: !verifiedRefs(block_refs) };
  });
  const tasks = (plan.textbook_tasks || []).map(task => {
    const { block_refs = [], answer_block_refs = [], ...fields } = task;
    if (!block_refs.length) throw Error(`Task ${task.task_id} needs block_refs`);
    return { ...fields, question_text: textOf(block_refs), page: bookPage(block_refs[0].pdf_page), source_block_refs: block_refs,
      expected_answer_if_given: answer_block_refs.length ? textOf(answer_block_refs) : null,
      confidence: verifiedRefs([...block_refs, ...answer_block_refs]) ? 'high' : 'medium',
      needs_manual_check: !verifiedRefs([...block_refs, ...answer_block_refs]) };
  });
  for (const ref of expandRefs(plan.ignored_blocks)) {
    if (!ref.reason?.trim()) throw Error(`Ignored block needs a reason: ${ref.block_id}`);
    resolve(ref);
  }
  const missing = [];
  for (const [page, { data }] of artifacts) for (const block of data.blocks) {
    if (consumed.has(`${page}:${block.id}`)) continue;
    const intervals = [...consumed].filter(key => key.startsWith(`${page}:${block.id}:`)).map(key => key.split(':').slice(-2).map(Number)).sort((a, b) => a[0] - b[0]);
    let covered = 0;
    for (const [start, end] of intervals) { if (start > covered) break; covered = Math.max(covered, end); }
    if (covered < block.text.length) missing.push(`${page}:${block.id}`);
  }
  if (missing.length) throw Error(`Unassigned source blocks: ${missing.slice(0, 12).join(', ')} (${missing.length} total). Assign or explicitly ignore with reasons.`);
  const dispositions = new Map((plan.page_dispositions || []).map(p => [p.pdf_page, p]));
  for (const entry of index.pages) {
    if (!entry.blocks && !dispositions.get(entry.pdfPage)?.reason) throw Error(`PDF page ${entry.pdfPage} has no text: explain blank/image/unreadable page in page_dispositions.`);
  }
  const notes = index.pages.filter(p => p.quality.flags.length).map(p => `PDF ${p.pdfPage}: ${p.quality.flags.join(', ')}`);
  const fullBook = index.pages.length === index.totalPages;
  const pack = {
    source: { file_name: index.pdfPath.split(/[\\/]/).at(-1), pdf_sha256: index.pdfSha256,
      text_corrections: plan.text_corrections || [],
      parsed_at: new Date().toISOString().slice(0, 10), version: 'v3', parser_version: index.parserVersion,
      verification: { method: 'agent_visual_review', block_refs: plan.verified_block_refs || [] },
      subject_kind: plan.subject_kind || 'stem', pdf_page_mapping: index.mapping,
      extraction_index: plan.extraction_index || null, coverage: { complete_book: fullBook,
        prepared_pdf_pages: index.pages.map(p => p.pdfPage), total_pdf_pages: index.totalPages,
        ignored_blocks: plan.ignored_blocks || [], page_dispositions: plan.page_dispositions || [] },
      extraction_method: { pdf_text_layer: index.pages.some(p => p.source === 'pdf_text_layer'),
        ocr_applied: index.pages.some(p => p.source !== 'pdf_text_layer'),
        ocr_languages: [...new Set([...artifacts.values()].flatMap(a => a.data.languages || []))],
        full_text_included: topics.some(t => t.full_text), cache_dir: index.cacheDir },
      quality_report: { high_confidence_blocks: [...verified],
        medium_confidence_blocks: index.pages.flatMap(p => artifacts.get(p.pdfPage).data.blocks
          .filter(b => !verified.has(`${p.pdfPage}:${b.id}`)).map(b => `${p.pdfPage}:${b.id}`)),
        low_confidence_blocks: index.pages.filter(p => !p.candidateUsable).map(p => `PDF ${p.pdfPage}`),
        note: [...(!fullBook ? ['Partial book extraction; remaining PDF pages are not covered.'] : []), ...notes].join('; ') } },
    metadata: plan.metadata || {}, topics_with_pages: topics, rules,
    example_tasks_v2: { verbatim_examples: [], verbatim_examples_status: { available: false, reason: 'See textbook_tasks for verbatim assignments.', next_step: '' },
      structural_examples_for_generation: plan.structural_examples_for_generation || [], textbook_tasks: tasks,
      textbook_tasks_status: { available: Boolean(tasks.length), count: tasks.length, reason: tasks.length ? '' : 'No tasks selected', next_step: '' } },
    generator_profile_kz_moem: plan.generator_profile_kz_moem || {},
  };
  const validation = validateParsed(pack);
  if (!validation.valid) throw Error(validation.errors.join('; '));
  return pack;
}
