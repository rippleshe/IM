import pptxgen from 'pptxgenjs';
import type { ResourceBlock, ResourceDocument } from '../src/learning/types.js';

type TableContent = {
  caption?: string;
  columns?: string[];
  rows?: Array<Array<string | number | null>>;
  sources?: string[];
};

type CodeContent = { caption?: string; language?: string; code?: string };

type PresentationSlide = {
  title: string;
  heading?: string;
  paragraphs: string[];
  bullets: string[];
  table?: TableContent;
  code?: CodeContent;
  kind: 'cover' | 'glossary' | 'evidence' | 'process' | 'practice' | 'summary' | 'concept';
};

const COLORS = {
  ink: '102A43',
  navy: '0B2239',
  blue: '2F6BFF',
  teal: '0D9488',
  orange: 'F59E0B',
  paper: 'F7FAFC',
  cloud: 'E8F0F6',
  line: 'CFDCE8',
  muted: '5E7184',
  white: 'FFFFFF',
  softBlue: 'EAF2FF',
  softTeal: 'E4F7F2',
  softOrange: 'FFF3D6',
};
const FONT = 'Microsoft YaHei';
const SLIDE_W = 13.333;
const SLIDE_H = 7.5;
const SHAPE_TYPES = new pptxgen().ShapeType;
const CHART_TYPES = new pptxgen().ChartType;

function plainText(value: string): string {
  return value
    .replace(/\*\*/g, '')
    .replace(/`/g, '')
    .replace(/^[-•]\s*/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function presentationDisplayTitle(value: string): string {
  return value.replace(/^(?:PPT|PowerPoint)\s*[·:：-]?\s*/i, '').trim() || value;
}

function shortText(value: string, max = 54): string {
  const text = plainText(value);
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function learnerFacingText(value: string): string {
  return value
    .replace(/这一页先让学习者复述重点，再完成页面底部的小动作。/gu, '本页先看清重点，再完成页面底部的小动作。')
    .replace(/让学习者/gu, '帮助你')
    .replace(/学习者/gu, '你')
    .replace(/讲解词/gu, '本页说明')
    .replace(/讲解时/gu, '阅读时')
    .trim();
}

function slideKind(title: string, hasTable: boolean, hasCode: boolean): PresentationSlide['kind'] {
  if (hasTable) return 'evidence';
  if (/词|术语|字段含义|关键词/.test(title)) return 'glossary';
  if (/练习|自测|检查|任务/.test(title)) return 'practice';
  if (/总结|行动|下一步|复核|边界|误区/.test(title)) return 'summary';
  if (/步骤|流程|方法|如何|解析|清洗|读取|观察/.test(title) || hasCode) return 'process';
  return 'concept';
}

function groupPresentationBlocks(resource: ResourceDocument): PresentationSlide[] {
  const blocks = [...resource.blocks]
    .filter((block) => block.type !== 'evidence')
    .sort((left, right) => left.position - right.position);
  const groups: ResourceBlock[][] = [];
  let current: ResourceBlock[] = [];
  for (const block of blocks) {
    if (block.type === 'heading' && current.length > 0) {
      groups.push(current);
      current = [];
    }
    current.push(block);
  }
  if (current.length > 0) groups.push(current);
  return groups.length > 0 ? groups.map((group) => {
    const heading = group.find((block) => block.type === 'heading');
    const paragraphs = group
      .filter((block) => block.type === 'paragraph' && typeof block.content === 'string')
      .map((block) => learnerFacingText(String(block.content)))
      .filter(Boolean);
    const bullets = group
      .filter((block) => (block.type === 'list' || block.type === 'checklist') && Array.isArray(block.content))
      .flatMap((block) => (block.content as unknown[]).filter((item): item is string => typeof item === 'string'))
      .map(plainText)
      .filter(Boolean)
      .slice(0, 5);
    const tableBlock = group.find((block) => block.type === 'table');
    const codeBlock = group.find((block) => block.type === 'code');
    const table = tableBlock?.content && typeof tableBlock.content === 'object' ? tableBlock.content as TableContent : undefined;
    const code = codeBlock?.content && typeof codeBlock.content === 'object' ? codeBlock.content as CodeContent : undefined;
    const title = heading ? plainText(String(heading.content)) : resource.title;
    return {
      title,
      heading: heading ? title : undefined,
      paragraphs,
      bullets,
      table,
      code,
      kind: heading ? slideKind(title, Boolean(table), Boolean(code)) : 'cover',
    };
  }) : [{ title: resource.title, paragraphs: [], bullets: [], kind: 'cover' }];
}

function addText(slide: pptxgen.Slide, text: string, options: pptxgen.TextPropsOptions): void {
  slide.addText(plainText(text), { fontFace: FONT, margin: 0, fit: 'shrink', breakLine: false, ...options });
}

function addPageChrome(slide: pptxgen.Slide, title: string, index: number, total: number): void {
  slide.background = { color: COLORS.paper };
  slide.addShape(SHAPE_TYPES.rect, { x: 0, y: 0, w: SLIDE_W, h: 0.12, line: { color: COLORS.blue, transparency: 100 }, fill: { color: COLORS.blue } });
  addText(slide, '智辩无幻  /  学习演示', { x: 0.68, y: 0.34, w: 2.6, h: 0.2, fontSize: 9, bold: true, color: COLORS.teal, charSpacing: 0.8 });
  addText(slide, title, { x: 0.68, y: 0.72, w: 9.7, h: 0.52, fontSize: 25, bold: true, color: COLORS.ink, breakLine: true, valign: 'middle' });
  addText(slide, `${String(index).padStart(2, '0')} / ${String(total).padStart(2, '0')}`, { x: 11.65, y: 0.42, w: 0.95, h: 0.22, fontSize: 9, color: COLORS.muted, align: 'right' });
  slide.addShape(SHAPE_TYPES.line, { x: 0.68, y: 1.45, w: 11.95, h: 0, line: { color: COLORS.line, pt: 1 } });
}

function addRoundedCard(slide: pptxgen.Slide, x: number, y: number, w: number, h: number, fill: string, line = fill): void {
  slide.addShape(SHAPE_TYPES.roundRect, { x, y, w, h, rectRadius: 0.08, fill: { color: fill }, line: { color: line, pt: 1 } });
}

function addNotes(slide: pptxgen.Slide, notes: string, fallback: string): void {
  slide.addNotes((notes.trim() || fallback).slice(0, 2_000));
}

function addCoverSlide(pptx: pptxgen, resource: ResourceDocument, slide: PresentationSlide, total: number): void {
  const output = pptx.addSlide();
  output.background = { color: COLORS.navy };
  output.addShape(SHAPE_TYPES.rect, { x: 0, y: 0, w: SLIDE_W, h: SLIDE_H, line: { color: COLORS.navy, transparency: 100 }, fill: { color: COLORS.navy } });
  output.addShape(SHAPE_TYPES.arc, { x: 9.25, y: -0.75, w: 5.3, h: 5.3, line: { color: '1C4460', pt: 2, transparency: 25 } });
  output.addShape(SHAPE_TYPES.arc, { x: 10.1, y: 3.6, w: 4.4, h: 4.4, line: { color: '2F6BFF', pt: 1.5, transparency: 42 } });
  output.addShape(SHAPE_TYPES.rect, { x: 0.76, y: 0.82, w: 0.12, h: 1.1, line: { color: COLORS.orange, transparency: 100 }, fill: { color: COLORS.orange } });
  addText(output, '设备数据诊断  /  学习演示', { x: 1.1, y: 0.92, w: 3.7, h: 0.28, fontSize: 11, bold: true, color: '9FD5CB', charSpacing: 1.2 });
  addText(output, presentationDisplayTitle(resource.title), { x: 1.1, y: 1.65, w: 8.6, h: 1.25, fontSize: 31, bold: true, color: COLORS.white, breakLine: true, valign: 'middle' });
  const lead = slide.paragraphs[0] ?? '从一个真实问题出发，先看懂，再观察，最后做出可复查的判断。';
  addText(output, shortText(lead, 190), { x: 1.12, y: 3.22, w: 7.25, h: 0.78, fontSize: 15, color: 'D6E4EF', breakLine: true, valign: 'top' });
  addRoundedCard(output, 1.1, 4.55, 7.8, 1.12, '173751', '2B526B');
  addText(output, '这套演示怎么用', { x: 1.42, y: 4.8, w: 1.65, h: 0.22, fontSize: 10, bold: true, color: '9FD5CB' });
  addText(output, '先看每页的一个重点，再用页面中的依据完成一个小判断。遇到不懂的字段，回到中文解释，不靠猜。', { x: 1.42, y: 5.08, w: 6.95, h: 0.4, fontSize: 12, color: COLORS.white, breakLine: true });
  const objective = resource.learningObjectives[0] ? shortText(resource.learningObjectives[0], 80) : '理解本次主题，并能沿着证据完成一次基础判断';
  addText(output, objective, { x: 1.12, y: 6.55, w: 8.6, h: 0.27, fontSize: 10, color: '9DB5C7' });
  addText(output, `01 / ${String(total).padStart(2, '0')}`, { x: 11.65, y: 6.55, w: 0.95, h: 0.24, fontSize: 10, color: '9DB5C7', align: 'right' });
  addNotes(output, lead, '开场先告诉学习者：这套内容不要求先背字段表，而是沿着一个问题逐步看懂证据、做出判断。');
}

function addAgendaSlide(pptx: pptxgen, titles: string[], index: number, total: number): void {
  const slide = pptx.addSlide();
  addPageChrome(slide, '今天走一条清晰的线', index, total);
  addText(slide, '整套演示按“先看懂，再判断，最后行动”的节奏展开。你可以把它当作一张路线图。', { x: 0.72, y: 1.76, w: 9.8, h: 0.4, fontSize: 14, color: COLORS.muted, breakLine: true });
  const phases: Array<[string, string]> = [
    ['先定义问题', '知道这一页要解决什么'],
    ['读懂最少字段', '只认识完成任务所需的词'],
    ['跟着看证据', '从样本、步骤和现象开始'],
    ['做判断与练习', '说清能得出什么、还缺什么'],
  ];
  phases.forEach(([heading, detail], phaseIndex) => {
    const x = 0.78 + (phaseIndex % 2) * 6.05;
    const y = 2.48 + Math.floor(phaseIndex / 2) * 1.58;
    addRoundedCard(slide, x, y, 5.38, 1.1, phaseIndex % 2 ? COLORS.softTeal : COLORS.softBlue, COLORS.line);
    slide.addShape(SHAPE_TYPES.ellipse, { x: x + 0.28, y: y + 0.27, w: 0.52, h: 0.52, line: { color: phaseIndex % 2 ? COLORS.teal : COLORS.blue, transparency: 100 }, fill: { color: phaseIndex % 2 ? COLORS.teal : COLORS.blue } });
    addText(slide, String(phaseIndex + 1), { x: x + 0.28, y: y + 0.39, w: 0.52, h: 0.18, fontSize: 10, bold: true, color: COLORS.white, align: 'center' });
    addText(slide, heading, { x: x + 1.02, y: y + 0.25, w: 3.5, h: 0.24, fontSize: 15, bold: true, color: COLORS.ink });
    addText(slide, detail, { x: x + 1.02, y: y + 0.61, w: 3.9, h: 0.22, fontSize: 11, color: COLORS.muted });
  });
  if (titles.length > 0) addText(slide, `后面会落到：${titles.slice(0, 4).map(plainText).join(' · ')}`, { x: 0.78, y: 6.05, w: 11.3, h: 0.32, fontSize: 10, color: COLORS.muted, breakLine: true });
  addNotes(slide, '', '这一页是路线图。先把问题说清楚，再只认识完成任务所需的少量字段，随后回到实际样本，最后练习如何表达判断和边界。');
}

function addGlossarySlide(slide: pptxgen.Slide, data: PresentationSlide): void {
  const entries = data.bullets.slice(0, 4).map((item) => {
    const match = item.match(/^(.{1,28}?)[：:](.*)$/);
    return { term: match?.[1] ?? '关键词', meaning: shortText(match?.[2] ?? item, 96) };
  });
  entries.forEach((entry, entryIndex) => {
    const x = 0.78 + (entryIndex % 2) * 6.05;
    const y = 1.9 + Math.floor(entryIndex / 2) * 2.05;
    addRoundedCard(slide, x, y, 5.38, 1.48, entryIndex % 2 ? COLORS.softTeal : COLORS.white, COLORS.line);
    addText(slide, entry.term, { x: x + 0.28, y: y + 0.24, w: 4.7, h: 0.24, fontSize: 16, bold: true, color: COLORS.ink });
    addText(slide, entry.meaning, { x: x + 0.28, y: y + 0.68, w: 4.7, h: 0.48, fontSize: 11, color: COLORS.muted, breakLine: true, valign: 'top' });
  });
  if (entries.length === 0) addText(slide, '这一页先把陌生词换成能观察、能复述的中文。', { x: 0.8, y: 2.2, w: 8, h: 0.35, fontSize: 17, color: COLORS.muted });
}

function addProcessSlide(slide: pptxgen.Slide, data: PresentationSlide): void {
  const items = data.bullets.slice(0, 4);
  const y = 2.08;
  slide.addShape(SHAPE_TYPES.line, { x: 1.25, y: y + 0.35, w: 10.5, h: 0, line: { color: 'B5CBE0', pt: 2, beginArrowType: 'none', endArrowType: 'triangle' } });
  items.forEach((item, itemIndex) => {
    const x = 0.86 + itemIndex * 3.02;
    slide.addShape(SHAPE_TYPES.ellipse, { x: x + 0.85, y, w: 0.72, h: 0.72, line: { color: itemIndex % 2 ? COLORS.teal : COLORS.blue, pt: 1.5 }, fill: { color: COLORS.white } });
    addText(slide, String(itemIndex + 1), { x: x + 0.85, y: y + 0.2, w: 0.72, h: 0.2, fontSize: 12, bold: true, color: itemIndex % 2 ? COLORS.teal : COLORS.blue, align: 'center' });
    addRoundedCard(slide, x, y + 1.15, 2.48, 1.55, COLORS.white, COLORS.line);
    addText(slide, shortText(item, 74), { x: x + 0.2, y: y + 1.45, w: 2.08, h: 0.78, fontSize: 12, bold: itemIndex === 0, color: COLORS.ink, breakLine: true, valign: 'middle' });
  });
  addText(slide, '跟着做：每完成一步，先说出“我看到了什么”，再决定下一步动作。', { x: 0.82, y: 5.35, w: 10.8, h: 0.32, fontSize: 13, color: COLORS.teal, bold: true });
}

function tableRows(content: TableContent): Array<Array<string | number>> {
  const columns = content.columns ?? [];
  return (content.rows ?? []).map((row) => columns.map((_, index) => {
    const cell = row[index];
    return cell === null || cell === undefined ? '—' : cell;
  }));
}

function addEvidenceSlide(slide: pptxgen.Slide, data: PresentationSlide): void {
  const table = data.table;
  const columns = table?.columns ?? [];
  const rows = tableRows(table ?? {});
  if (columns.length === 0 || rows.length === 0) {
    addText(slide, '这页没有可直接展示的样本表，先回到字段解释和观察步骤。', { x: 0.8, y: 2.2, w: 8, h: 0.35, fontSize: 17, color: COLORS.muted });
    return;
  }
  addText(slide, '只展示当前检索到的少量样本，用来练习“先描述，再判断”。', { x: 0.74, y: 1.7, w: 7, h: 0.28, fontSize: 12, color: COLORS.muted });
  const header = columns.map((column) => ({ text: shortText(column, 18), options: { bold: true, color: COLORS.white, fill: { color: COLORS.ink }, fontFace: FONT, fontSize: 9, margin: 0.06 } }));
  const body = rows.map((row) => row.map((cell) => ({ text: shortText(String(cell), 18), options: { color: COLORS.ink, fill: { color: COLORS.white }, fontFace: FONT, fontSize: 8.5, margin: 0.06 } })));
  slide.addTable([header, ...body], { x: 0.72, y: 2.12, w: 6.3, h: 2.25, border: { type: 'solid', color: COLORS.line, pt: 0.7 }, colW: columns.map(() => 6.3 / columns.length), rowH: 0.42, margin: 0.06, valign: 'middle' });
  const numericIndex = columns.findIndex((_, columnIndex) => rows.length > 1 && rows.every((row) => typeof row[columnIndex] === 'number' && Number.isFinite(row[columnIndex] as number)));
  if (numericIndex >= 0) {
    const numericValues = rows.map((row) => row[numericIndex] as number);
    slide.addChart(CHART_TYPES.line, [{ name: columns[numericIndex] ?? '样本读数', labels: numericValues.map((_, index) => `样本${index + 1}`), values: numericValues }], {
      x: 7.35, y: 1.86, w: 5.22, h: 2.95, showLegend: false, showTitle: true, title: '样本读数对照（仅当前样本）', titleAlign: 'left', titleFontFace: FONT, titleFontSize: 11, titleColor: COLORS.ink,
      chartColors: [COLORS.blue], lineSize: 3, catAxisLabelFontFace: FONT, catAxisLabelFontSize: 8, catAxisLabelColor: COLORS.muted, catAxisLineColor: COLORS.line, valAxisLabelFontFace: FONT, valAxisLabelFontSize: 8, valAxisLabelColor: COLORS.muted, valAxisLineColor: COLORS.line, valGridLine: { color: COLORS.line, size: 0.7 }, showValue: false, showLabel: false, showSerName: false,
    });
  }
  addRoundedCard(slide, 0.74, 4.85, 11.85, 0.92, COLORS.softOrange, 'F2D894');
  addText(slide, '读图提醒', { x: 1.02, y: 5.1, w: 0.9, h: 0.2, fontSize: 11, bold: true, color: '9A6700' });
  addText(slide, '表格告诉你“这几行记录是什么样”，曲线只帮助看变化；它们都不能单独证明设备已经发生故障。', { x: 2.0, y: 5.06, w: 9.95, h: 0.28, fontSize: 12, color: '704E00' });
  const source = table?.sources?.[0];
  if (source) addText(slide, `来源：${shortText(source, 115)}`, { x: 0.78, y: 6.15, w: 11.5, h: 0.2, fontSize: 8.5, color: COLORS.muted });
}

function addPracticeSlide(slide: pptxgen.Slide, data: PresentationSlide): void {
  addRoundedCard(slide, 0.82, 1.95, 7.28, 3.65, COLORS.white, COLORS.line);
  addText(slide, '现在只做一件事', { x: 1.2, y: 2.3, w: 2.1, h: 0.25, fontSize: 12, bold: true, color: COLORS.orange });
  addText(slide, shortText(data.paragraphs[0] ?? data.bullets[0] ?? '请用自己的话说出这一页的关键判断。', 190), { x: 1.2, y: 2.85, w: 6.35, h: 1.05, fontSize: 20, bold: true, color: COLORS.ink, breakLine: true, valign: 'middle' });
  const tasks = data.bullets.slice(0, 3);
  tasks.forEach((task, index) => {
    slide.addShape(SHAPE_TYPES.ellipse, { x: 8.75, y: 2.06 + index * 1.1, w: 0.48, h: 0.48, line: { color: COLORS.blue, transparency: 100 }, fill: { color: COLORS.blue } });
    addText(slide, String(index + 1), { x: 8.75, y: 2.19 + index * 1.1, w: 0.48, h: 0.16, fontSize: 9, bold: true, color: COLORS.white, align: 'center' });
    addText(slide, shortText(task, 82), { x: 9.5, y: 2.12 + index * 1.1, w: 2.85, h: 0.38, fontSize: 12, color: COLORS.ink, breakLine: true });
  });
  addText(slide, '完成后对照本页说明，先保留自己的判断。', { x: 1.2, y: 4.78, w: 5.8, h: 0.24, fontSize: 11, color: COLORS.muted });
}

function addConceptSlide(slide: pptxgen.Slide, data: PresentationSlide): void {
  const bullets = data.bullets.slice(0, 4);
  const key = bullets[0] ?? data.paragraphs[0] ?? '先用一句话说清这一页的核心意思。';
  addRoundedCard(slide, 0.78, 1.86, 3.55, 3.96, COLORS.ink, COLORS.ink);
  addText(slide, '这一页只记住', { x: 1.12, y: 2.25, w: 1.7, h: 0.2, fontSize: 11, bold: true, color: '9FD5CB' });
  addText(slide, shortText(key, 105), { x: 1.12, y: 2.75, w: 2.78, h: 1.48, fontSize: 21, bold: true, color: COLORS.white, breakLine: true, valign: 'middle' });
  addText(slide, data.kind === 'summary' ? '把结论和边界一起说' : '先观察，再解释', { x: 1.12, y: 5.13, w: 2.4, h: 0.24, fontSize: 11, color: 'B5CBE0' });
  bullets.slice(1).forEach((bullet, index) => {
    const y = 1.98 + index * 1.18;
    addRoundedCard(slide, 4.8, y, 7.65, 0.9, index % 2 ? COLORS.softTeal : COLORS.white, COLORS.line);
    slide.addShape(SHAPE_TYPES.ellipse, { x: 5.12, y: y + 0.25, w: 0.38, h: 0.38, line: { color: index % 2 ? COLORS.teal : COLORS.blue, transparency: 100 }, fill: { color: index % 2 ? COLORS.teal : COLORS.blue } });
    addText(slide, String(index + 2), { x: 5.12, y: y + 0.35, w: 0.38, h: 0.13, fontSize: 8, bold: true, color: COLORS.white, align: 'center' });
    addText(slide, shortText(bullet, 98), { x: 5.72, y: y + 0.22, w: 6.35, h: 0.38, fontSize: 13, color: COLORS.ink, breakLine: true, valign: 'middle' });
  });
  if (bullets.length < 2) addText(slide, '讲解时，请在样本中找一个能对应这句话的地方。', { x: 4.85, y: 3.2, w: 6.7, h: 0.3, fontSize: 14, color: COLORS.muted });
}

/** 生成真正的 OOXML PowerPoint：页内元素可编辑，备注写入 speaker notes，数据页使用原生表格/图表。 */
export async function resourceToPptx(resource: ResourceDocument): Promise<Buffer> {
  const contentSlides = groupPresentationBlocks(resource);
  const slides = contentSlides[0]?.kind === 'cover' ? contentSlides : [{ title: resource.title, paragraphs: [], bullets: [], kind: 'cover' as const }, ...contentSlides];
  const total = slides.length + 1;
  const pptx = new pptxgen();
  pptx.layout = 'LAYOUT_WIDE';
  pptx.author = '智辩无幻';
  pptx.company = '智辩无幻';
  pptx.subject = resource.title;
  pptx.title = resource.title;
  pptx.theme = {
    headFontFace: FONT,
    bodyFontFace: FONT,
  };

  const cover = slides[0]!;
  addCoverSlide(pptx, resource, cover, total);
  addAgendaSlide(pptx, slides.slice(1).map((slide) => slide.title), 2, total);
  slides.slice(1).forEach((data, index) => {
    const slide = pptx.addSlide();
    const page = index + 3;
    addPageChrome(slide, data.title, page, total);
    if (data.kind === 'glossary') addGlossarySlide(slide, data);
    else if (data.kind === 'evidence') addEvidenceSlide(slide, data);
    else if (data.kind === 'process') addProcessSlide(slide, data);
    else if (data.kind === 'practice') addPracticeSlide(slide, data);
    else addConceptSlide(slide, data);
    addNotes(slide, data.paragraphs.join('\n\n'), `这一页围绕“${data.title}”展开。请先看页面中的关键依据，再用自己的话概括结论，并标出仍需确认的部分。`);
  });
  const output = await pptx.write({ outputType: 'nodebuffer', compression: true });
  if (!Buffer.isBuffer(output)) throw new Error('PowerPoint 导出结果不是二进制文件');
  return output;
}
