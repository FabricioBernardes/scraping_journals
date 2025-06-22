import { readFileSync, writeFileSync } from 'fs';

const inputFile = './raw/cadernos_lepaarq.json';
const outputFile = 'seeds.rb';

const data = JSON.parse(readFileSync(inputFile, 'utf8'));

function escape(str) {
  if (!str) return '';
  // Escapa apenas aspas duplas e barras invertidas para Ruby
  return str
    .replace(/\\/g, "\\\\") // barra invertida
    .replace(/\"/g, '\\"');   // aspas duplas
}

function toRubyHash(obj, indent = 2) {
  const pad = ' '.repeat(indent);
  let str = '{ ';
  const entries = Object.entries(obj).map(([k, v]) => {
    let value;
    if (Array.isArray(v)) {
      value = '[' + v.map(e => typeof e === 'string' ? `"${escape(e)}"` : toRubyHash(e, 0)).join(', ') + ']';
    } else if (typeof v === 'string') {
      value = `"${escape(v)}"`;
    } else if (v === null || v === undefined) {
      value = 'nil';
    } else {
      value = v;
    }
    return `${k}: ${value}`;
  });
  str += entries.join(', ');
  str += ' }';
  return str;
}

// Função para gerar identificador Ruby seguro a partir do volume da edição
function editionVarName(volume) {
  return (
    'lepaarq_' +
    volume
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
  );
}

const scientific_journals = [
  {
    name: "Laboratório de Ensino e Pesquisa em Antropologia e Arqueologia",
    institutional_affiliation: "Universidade Federal de Pelotas - UFPEL",
    issn: "1806-9118",
    thematic_scope: "Arqueologia e Antropologia",
    website_url: "https://periodicos.ufpel.edu.br/index.php/lepaarq",
    periodicity: "Semestral",
    current_status: "Ativa",
    foundation_year: 2004,
    closure_year: null,
    qualis: "A2"
  }
];

let seed = `scientific_journals = [\n`;
seed += scientific_journals.map(j => `  ${toRubyHash(j)}`).join(',\n');
seed += `\n]\n\n`;
seed += `scientific_journals.each do |attrs|\n  ScientificJournal.find_or_create_by!(issn: attrs[:issn]) do |journal|\n    journal.assign_attributes(attrs)\n  end\nend\n\n`;

const lepaarq_editions = data.map(edition => ({
  edition_type: edition.edition_type || null,
  publication_date: edition.date,
  url: edition.url,
  volume: edition.edition
}));

seed += `lepaarq = ScientificJournal.find_by!(issn: '1806-9118')\n\nlepaarq_editions = [\n`;
seed += lepaarq_editions.map(e => `  ${toRubyHash(e)}`).join(',\n');
seed += `\n]\n\nlepaarq_editions.each do |attrs|\n  Edition.find_or_create_by!(scientific_journal: lepaarq, volume: attrs[:volume], edition_type: attrs[:edition_type]) do |edition|\n    edition.publication_date = attrs[:publication_date]\n    edition.url = attrs[:url]\n    edition.editors = nil\n    edition.theme = nil\n    edition.doi = nil\n    edition.available_format = nil\n  end\nend\n\n`;

// Artigos agrupados por edição
for (const edition of data) {
  const varName = editionVarName(edition.edition);
  const articlesArr = (edition.articles || []).map(article => ({
    title: article.title,
    authors: article.authors || [],
    article_url: article.url,
    doi: article.doi || null,
    keywords: article.keywords || [],
    abstract: article.abstract || null
  }));
  seed += `${varName}_edition = Edition.find_by!(volume: '${escape(edition.edition)}')\n${varName}_articles = [\n`;
  seed += articlesArr.map(a => `  ${toRubyHash(a)}`).join(',\n');
  seed += `\n]\n${varName}_articles.each do |attrs|\n  author_records = attrs[:authors].map { |author_name| Author.find_or_create_by!(name: author_name) }\n  keyword_records = (attrs[:keywords] || []).map { |kw| Keyword.find_or_create_by!(name: kw) }\n  Article.find_or_create_by!(title: attrs[:title], edition: ${varName}_edition) do |article|\n    article.authors = author_records\n    article.article_url = attrs[:article_url]\n    article.doi = attrs[:doi]\n    article.abstract = attrs[:abstract]\n    article.keywords = keyword_records\n  end\nend\n\n`;
}

writeFileSync(outputFile, seed, 'utf8');
console.log('Arquivo de seeds gerado em', outputFile);