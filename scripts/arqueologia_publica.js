import axios from 'axios';
import { load } from 'cheerio';
import { writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import ProgressBar from 'progress';
import https from 'https';

const __dirname = dirname(fileURLToPath(import.meta.url));

const SELECTORS = {
  editionCard: '.card.issue-summary',
  editionLink: 'a',
  editionTitle: '.card-title>a',
  editionDate: '.page-issue-date',
  articleSummary: '.article-summary',
  articleTitle: '.article-summary-title>a',
  articleAuthors: '.article-summary-authors',
  articleDOI: '.csl-entry a',
  articleKeywords: '.article-details-keywords-value span',
  articleAbstract: '.article-details-abstract p'
};

const BASE_URL = 'https://periodicos.sbu.unicamp.br/ojs/index.php/rap/issue/archive';
const ARCHIVE_URL = [`${BASE_URL}/1`, `${BASE_URL}/2`];

const httpsAgent = new https.Agent({ rejectUnauthorized: false });

async function scrapeEditionsList() {
  const allEditions = [];
  for (const url of ARCHIVE_URL) {
    const res = await axios.get(url, { httpsAgent });

    if (res.status !== 200) {
      throw new Error(`Erro ao acessar a página de arquivo: ${res.status}`);
    }

    const edition = load(res.data);
    const editions = [];

    edition(SELECTORS.editionCard).each((_, el) => {
      const link = edition(el).find(SELECTORS.editionLink).attr('href');
      const title = edition(el).find(SELECTORS.editionTitle).text().trim();
      if (link) {
        editions.push({ title, url: link });
      }
    });

    allEditions.push(editions);
  }

  return allEditions.reduce((acc, curr) => acc.concat(curr), []);
}

async function scrapEditionPages(editions) {
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
    let dateText = article(SELECTORS.editionDate).text().trim();
    dateText = dateText.replace(/^publicado em\s*/i, '').trim();
    edition.date = dateText;

    article(SELECTORS.articleSummary).each((_, el) => {
      let title = article(el).find(SELECTORS.articleTitle).text().trim();
      const authors = [];
      const authorsText = article(el).find(SELECTORS.articleAuthors).text();
      const url = article(el).find(SELECTORS.articleTitle).attr('href');

      let splitAuthors;
      if (authorsText.includes(';')) {
        splitAuthors = authorsText.replace(/["“”]/g, "'").split(';');
      } else {
        splitAuthors = authorsText.replace(/["“”]/g, "'").split(',');
      }

      splitAuthors.forEach(name => {
        const clean = name.replace(/\s+/g, ' ').trim();
        if (clean) authors.push(clean);
      });

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

export async function scrapeArticlePages(editionPagesinformation) {
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

        // DOI
        let doi = '';
        const doiDiv = $(SELECTORS.articleDOI);
        if (doiDiv.length) {
          doi = doiDiv.attr('href') || doiDiv.text().trim();
        }
        // Palavras-chave
        let keywords = [];
        $(SELECTORS.articleKeywords).each((_, el) => {
          const keyword = $(el).text()
          if (keyword) keywords.push(keyword);
        });

        // Resumo
        const abstract = $(SELECTORS.articleAbstract).text().trim();

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

async function init() {
  const editions = await scrapeEditionsList();
  const editionPagesinformation = await scrapEditionPages(editions);
  const data = await scrapeArticlePages(editionPagesinformation);
  writeFile(data, 'arqueologia_publica.json');
}

init().catch(err => console.error('Erro durante a execução:', err));
