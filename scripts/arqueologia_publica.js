import axios from 'axios';
import { load } from 'cheerio';
import { writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import ProgressBar from 'progress';
import https from 'https';

const __dirname = dirname(fileURLToPath(import.meta.url));

const PERIODICAL_CONFIG = {
  name: 'Arqueologia Pública',
  fileName: 'arqueologia_publica.json',
  archiveUrls: [
    'https://periodicos.sbu.unicamp.br/ojs/index.php/rap/issue/archive/1',
    'https://periodicos.sbu.unicamp.br/ojs/index.php/rap/issue/archive/2',
  ],
  selectors: {
    editionCard: '.card.issue-summary',
    editionLink: 'a',
    editionTitle: '.card-title>a',
    editionDate: '.page-issue-date',
    articleSummary: '.article-summary',
    articleTitle: '.article-summary-title>a',
    articleAuthors: '.article-summary-authors',
    articleDOI: '.csl-entry a',
    articleKeywords: '.article-details-keywords-value span',
    articleAbstract: '.article-details-abstract',
  },
};

const httpsAgent = new https.Agent({ rejectUnauthorized: false });

function extractAuthors(authorsText) {
  let splitAuthors;
  if (authorsText.includes(';')) {
    splitAuthors = authorsText.replace(/["“”]/g, "'").split(';');
  } else {
    splitAuthors = authorsText.replace(/["“”]/g, "'").split(',');
  }
  return splitAuthors.map(name => name.replace(/\s+/g, ' ').trim()).filter(Boolean);
}

function extractKeywords($, config) {
  const keywords = [];
  $(config.selectors.articleKeywords).each((_, el) => {
    let keyword = $(el).text()

    if (keyword.includes('. ')){
      keyword = keyword.split('. ').map(k => k.trim().replace('.', '')).filter(Boolean);
    };

    if (keyword) keywords.push(keyword);
  });
  return keywords;
}

function extractAbstract($, config) {
  const abstractEl = $(config.selectors.articleAbstract);
  const p = abstractEl.find('p');

  if (p.length) {
    return p.text().trim();
  }

  let html = abstractEl.html() || '';
  html = html.replace(/^<h2[^>]*>.*?<\/h2>/i, '').trim();

  return $('<div>').html(html).text().trim();
}

async function scrapeEditionsList(config) {
  const allEditions = [];
  for (const url of config.archiveUrls) {
    const res = await axios.get(url, { httpsAgent });
    if (res.status !== 200) {
      throw new Error(`Erro ao acessar a página de arquivo: ${res.status}`);
    }
    const edition = load(res.data);
    const editions = [];
    edition(config.selectors.editionCard).each((_, el) => {
      const link = edition(el).find(config.selectors.editionLink).attr('href');
      const title = edition(el).find(config.selectors.editionTitle).text().trim();
      if (link) {
        editions.push({ title, url: link });
      }
    });
    allEditions.push(editions);
  }
  return allEditions.flat();
}

async function scrapEditionPages(editions, config) {
  const bar = new ProgressBar('Scraping editions [:bar] :current/:total', {
    total: editions.length,
    width: 30,
    incomplete: ' ',
    complete: '=',
  });
  const result = [];

  for (const edition of editions) {
    const res = await axios.get(edition.url, { httpsAgent });
    const article = load(res.data);
    const articles = [];

    let dateText = article(config.selectors.editionDate).text().trim();
    dateText = dateText.replace(/^publicado em\s*/i, '').trim();
    edition.date = dateText;

    article(config.selectors.articleSummary).each((_, el) => {
      let title = article(el).find(config.selectors.articleTitle).text().trim();
      const authorsText = article(el).find(config.selectors.articleAuthors).text();
      const url = article(el).find(config.selectors.articleTitle).attr('href');
      const authors = extractAuthors(authorsText);
      articles.push({ url, title, authors });
    });

    result.push({
      edition: edition.title,
      url: edition.url,
      date: edition.date,
      articles
    });

    bar.tick();
  }

  return result;
}

export async function scrapeArticlePages(editionPagesinformation, config) {
  const totalArticles = editionPagesinformation.reduce((sum, edition) => sum + edition.articles.length, 0);

  const bar = new ProgressBar('Scraping articles [:bar] :current/:total', {
    total: totalArticles,
    width: 30,
    incomplete: ' ',
    complete: '=',
  });

  for (const edition of editionPagesinformation) {
    for (const article of edition.articles) {
      const url = article.url;

      try {
        const res = await axios.get(url, { httpsAgent });
        const $ = load(res.data);

        let doi = '';
        const doiDiv = $(config.selectors.articleDOI);
        if (doiDiv.length) {
          doi = doiDiv.attr('href') || doiDiv.text().trim();
        }

        const keywords = extractKeywords($, config);

        const abstract = extractAbstract($, config);
        article.doi = doi;
        article.keywords = keywords;
        article.abstract = abstract;
      } catch (err) {
        article.doi = '';
        article.keywords = [];
        article.abstract = '';
        article.error = err.message;
        console.error(`Erro ao acessar o artigo ${article.title}: ${err.message}`);
      }

      bar.tick();
    }
  }

  return editionPagesinformation;
}

async function writeFile(data, filename) {
  const outputDir = join(__dirname, '../raw');
  const outputPath = join(outputDir, filename);
  writeFileSync(outputPath, JSON.stringify(data, null, 2), 'utf8');
  console.log(`Arquivo salvo em: ${outputPath}`);
}

async function init(config) {
  const editions = await scrapeEditionsList(config);
  const editionPagesinformation = await scrapEditionPages(editions, config);
  const data = await scrapeArticlePages(editionPagesinformation, config);
  writeFile(data, config.fileName);
}

init(PERIODICAL_CONFIG).catch(err => console.error('Erro durante a execução:', err));
