import { readFileSync, writeFileSync } from 'fs';
import { readdirSync } from 'fs';

const runDataTransformation = function (journalData, journalName) {
  const data = journalData || [];

  function escape(str) {
    if (!str) return '';
    return str
      .replace(/\\/g, "\\\\")
      .replace(/\"/g, '\\"');
  }

  function toRubyHash(obj, indent = 2) {
    const pad = ' '.repeat(indent);
    let str = '{ ';
    const entries = Object.entries(obj).map(([k, v]) => {
      let value;
      if (Array.isArray(v)) {
        // Ensure all arrays are arrays of strings (for keywords and authors)
        value = '[' + v.map(e => typeof e === 'string' ? `"${escape(e)}"` : (typeof e === 'object' && e !== null ? toRubyHash(e, 0) : JSON.stringify(e))).join(', ') + ']';
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

  function editionVarName(volume) {
    return (
      `${journalName}_` +
      volume
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
    );
  }

  const scientific_journals = [
    {
      name: journalName,
      institutional_affiliation: "",
      issn: "",
      thematic_scope: "",
      website_url: "",
      periodicity: "",
      current_status: "",
      foundation_year: 0,
      closure_year: null,
      qualis: ""
    }
  ];

  let seed = `scientific_journals = [\n`;
  seed += scientific_journals.map(j => `  ${toRubyHash(j)}`).join(',\n');
  seed += `\n]\n\n`;
  seed += `scientific_journals.each do |attrs|\n  ScientificJournal.find_or_create_by!(issn: attrs[:issn]) do |journal|\n    journal.assign_attributes(attrs)\n  end\nend\n\n`;

  const journal_editions = data.map(edition => ({
    edition_type: edition.edition_type || null,
    publication_date: edition.date,
    url: edition.url,
    volume: edition.edition
  }));

  seed += `${journalName} = ScientificJournal.find_by!(name: '${journalName}')\n\n${journalName}_editions = [\n`;
  seed += journal_editions.map(e => `  ${toRubyHash(e)}`).join(',\n');
  seed += `\n]\n\n${journalName}_editions.each do |attrs|\n  Edition.find_or_create_by!(scientific_journal: ${journalName}, volume: attrs[:volume], edition_type: attrs[:edition_type]) do |edition|\n    edition.publication_date = attrs[:publication_date]\n    edition.url = attrs[:url]\n    edition.editors = nil\n    edition.theme = nil\n    edition.doi = nil\n    edition.available_format = nil\n  end\nend\n\n`;

  for (const edition of data) {
    const varName = editionVarName(edition.edition);
    const articlesArr = (edition.articles || []).filter(article => Array.isArray(article.authors) && article.authors.length > 0).map(article => ({
      title: article.title,
      authors: article.authors,
      article_url: article.url,
      doi: article.doi || null,
      keywords: article.keywords || [],
      abstract: article.abstract || null
    }));
    seed += `${varName}_edition = Edition.find_by!(volume: '${escape(edition.edition)}')\n${varName}_articles = [\n`;
    seed += articlesArr.map(a => `  ${toRubyHash(a)}`).join(',\n');
    seed += `\n]\n${varName}_articles.each do |attrs|\n  author_records = attrs[:authors].map { |author_name| Author.find_or_create_by!(name: author_name) }\n  keyword_records = (attrs[:keywords] || []).map { |kw| Keyword.find_or_create_by!(name: kw) }\n  Article.find_or_create_by!(title: attrs[:title], edition: ${varName}_edition) do |article|\n    article.authors = author_records\n    article.article_url = attrs[:article_url]\n    article.doi = attrs[:doi]\n    article.abstract = attrs[:abstract]\n    article.keywords = keyword_records\n  end\nend\n\n`;
  }

  const outputFile = `results/rails_seeds/${journalName}_seeds.rb`;

  writeFileSync(outputFile, seed, 'utf8');
  console.log('Arquivo de seeds gerado em', outputFile);

};

const init = function () {
  const journals = readdirSync('raw').filter(file => file.endsWith('.json'));

  for (const journal of journals) {
    const journalData = JSON.parse(readFileSync(`raw/${journal}`, 'utf8'));
    const journalName = journal.replace('.json', '');

    runDataTransformation(journalData, journalName);
  }
}

init();