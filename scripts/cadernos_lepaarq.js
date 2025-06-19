import axios from 'axios';
import { load } from 'cheerio';
import { writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import ProgressBar from 'progress';

const __dirname = dirname(fileURLToPath(import.meta.url));

const BASE_URL = 'https://periodicos.ufpel.edu.br';
const ARCHIVE_URL = [`${BASE_URL}/index.php/lepaarq/issue/archive`, `${BASE_URL}/index.php/lepaarq/issue/archive/2`];

const SELECTORS = {
  issueSummary: '.obj_issue_summary',
  issueTitle: 'a.title',
  publishedDate: '.heading .published .value',
  articleSummary: '.obj_article_summary',
  articleTitle: '.obj_article_summary .title a',
  articleAuthors: '.obj_article_summary .meta .authors',
  doi: '.item.doi .value a',
  abstract: '.item.abstract',
  abstractLabel: 'h3.label',
};

async function scrapeEditionsList() {
  const allEditions = [];
  for (const url of ARCHIVE_URL) {
    const res = await axios.get(url);

    if (res.status !== 200) {
      throw new Error(`Erro ao acessar a página de arquivo: ${res.status}`);
    }

    const edition = load(res.data);
    const editions = [];

    edition(SELECTORS.issueSummary).each((_, el) => {
      const link = edition(el).find(SELECTORS.issueTitle).attr('href');
      const title = edition(el).find(SELECTORS.issueTitle).text().trim();
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
    const res = await axios.get(edition.url);
    const article = load(res.data);
    const articles = [];
    edition.date = article(SELECTORS.publishedDate).text().trim();

    article(SELECTORS.articleSummary).each((_, el) => {
      let title = article(el).find(SELECTORS.articleTitle).text().replace(/PDF/gi, '').replace(/\s+/g, ' ').trim();
      const authors = [];
      const authorsText = article(el)
        .find(SELECTORS.articleAuthors)
        .text();
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

async function writeFile(data, filename) {
  const outputDir = join(__dirname, '../raw');
  const outputPath = join(outputDir, filename);
  writeFileSync(outputPath, JSON.stringify(data, null, 2), 'utf8');
  console.log(`Arquivo salvo em: ${outputPath}`);
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
        const res = await axios.get(url);
        const $ = load(res.data);
        // DOI
        let doi = '';
        // Extrai o DOI do bloco .item.doi
        const doiDiv = $(SELECTORS.doi);
        if (doiDiv.length) {
          doi = doiDiv.attr('href') || doiDiv.text().trim();
        }
        // Palavras-chave
        let keywords = [];
        const keywordsText = $('body').text().match(/Palavras-chave:\s*([^\n]+)/i);
        if (keywordsText && keywordsText[1]) {
          keywords = keywordsText[1].replace(/["“”]/g, "'").split(',').map(k => k.trim()).filter(Boolean);
        }
        // Resumo
        let abstract = '';
        // Extrai o texto do resumo removendo o h3 inicial
        const abstractDiv = $(SELECTORS.abstract);
        if (abstractDiv.length) {
          // Remove o h3 e pega o texto limpo
          abstractDiv.find(SELECTORS.abstractLabel).remove();
          abstract = abstractDiv.text().replace(/\s+/g, ' ').trim();
        }
        // Adiciona os novos campos ao artigo
        article.doi = doi;
        article.keywords = keywords;
        article.abstract = abstract.replace(/["“”]/g, "'");
      } catch (err) {
        article.doi = '';
        article.keywords = [];
        article.abstract = '';
        article.error = err.message;
      }
      bar.tick();
    }
  }
  return editionPagesinformation;
}

async function init() {
  const editions = await scrapeEditionsList();
  const editionPagesinformation = await scrapEditionPages(editions);
  const data = await scrapeArticlePages(editionPagesinformation);
  writeFile(data, 'cadernos_lepaarq.json');
}

init().catch(err => console.error('Erro durante a execução:', err));
