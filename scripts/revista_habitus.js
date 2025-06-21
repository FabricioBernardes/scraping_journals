import axios from 'axios';
import { load } from 'cheerio';
import { writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import ProgressBar from 'progress';

const __dirname = dirname(fileURLToPath(import.meta.url));

const PERIODICAL_CONFIG = {
  name: 'Revista Habitus',
  fileName: 'revista_habitus.json',
  archiveUrls: [
    'https://seer.pucgoias.edu.br/index.php/habitus/issue/archive/1',
    'https://seer.pucgoias.edu.br/index.php/habitus/issue/archive/2',
  ],
  selectors: {
    issueSummary: '.obj_issue_summary',
    issueTitle: 'a.title',
    issueSeries: 'div.series',
    publishedDate: '.heading .published .value',
    articleSummary: '.obj_article_summary',
    articleTitle: '.obj_article_summary .title a',
    articleAuthors: '.obj_article_summary .meta .authors',
    doi: '.item.doi .value a',
    abstract: '.item.abstract',
    abstractLabel: 'h3.label',
  },
  keywordsRegex: /Palavras-chave:\s*([^\n]+)/i,
};

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
  const keywordsText = $('body').text().match(config.keywordsRegex);
  if (keywordsText && keywordsText[1]) {
    return keywordsText[1].replace(/["“”]/g, "'").split(',').map(k => k.trim()).filter(Boolean);
  }
  return [];
}

function extractAbstract($, config) {
  const abstractDiv = $(config.selectors.abstract);
  if (abstractDiv.length) {
    abstractDiv.find(config.selectors.abstractLabel).remove();
    return abstractDiv.text().replace(/\s+/g, ' ').replace(/["“”]/g, "'").trim();
  }
  return '';
}

async function scrapeEditionsList(config) {
  const editionResults = await Promise.all(
    config.archiveUrls.map(async (url) => {
      const res = await axios.get(url);
      if (res.status !== 200) {
        throw new Error(`Erro ao acessar a página de arquivo: ${res.status}`);
      }
      const edition = load(res.data);
      const editions = [];
      edition(config.selectors.issueSummary).each((_, el) => {
        const link = edition(el).find(config.selectors.issueTitle).attr('href');
        const title = edition(el).find(config.selectors.issueTitle).text().trim();
        const series = edition(el).find(config.selectors.issueSeries).text().trim();
        const concatenatedTitle = series ? `${series} - ${title}` : title;
        if (link) {
          editions.push({ title: concatenatedTitle, url: link });
        }
      });
      return editions;
    })
  );
  return editionResults.flat();
}

async function scrapEditionPages(editions, config) {
  const bar = new ProgressBar('Scraping editions [:bar] :current/:total', {
    total: editions.length,
    width: 30,
    incomplete: ' ',
    complete: '=',
  });

  const editionResults = await Promise.all(
    editions.map(async (edition) => {
      const res = await axios.get(edition.url);
      const article = load(res.data);
      const articles = [];
      edition.date = article(config.selectors.publishedDate).text().trim();
      article(config.selectors.articleSummary).each((_, el) => {
        let title = article(el).find(config.selectors.articleTitle).text().replace(/PDF/gi, '').replace(/\s+/g, ' ').trim();
        const authorsText = article(el).find(config.selectors.articleAuthors).text();
        const url = article(el).find(config.selectors.articleTitle).attr('href');
        const authors = extractAuthors(authorsText);
        articles.push({ url, title, authors });
      });
      bar.tick();
      return {
        edition: edition.title,
        url: edition.url,
        date: edition.date,
        articles
      };
    })
  );
  return editionResults;
}

async function writeFile(data, filename) {
  const outputDir = join(__dirname, '../raw');
  const outputPath = join(outputDir, filename);
  writeFileSync(outputPath, JSON.stringify(data, null, 2), 'utf8');
  console.log(`Arquivo salvo em: ${outputPath}`);
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
    await Promise.all(
      edition.articles.map(async (article) => {
      const url = article.url;
      let attempt = 0;
      let success = false;
      while (attempt < 2 && !success) {
        try {
        const res = await axios.get(url);
        const $ = load(res.data);

        let doi = '';
        const doiDiv = $(config.selectors.doi);
        if (doiDiv.length) {
          doi = doiDiv.attr('href') || doiDiv.text().trim();
        }

        const keywords = extractKeywords($, config);
        const abstract = extractAbstract($, config);

        article.doi = doi;
        article.keywords = keywords;
        article.abstract = abstract;
        success = true;
        } catch (err) {
        attempt++;
        if (attempt === 2) {
          article.doi = '';
          article.keywords = [];
          article.abstract = '';
          article.error = err.message;
        }
        }
      }
      bar.tick();
      })
    );
  }
  return editionPagesinformation;
}

async function init(config) {
  const editions = await scrapeEditionsList(config);
  const editionPagesinformation = await scrapEditionPages(editions, config);
  const data = await scrapeArticlePages(editionPagesinformation, config);
  writeFile(data, config.fileName);
}

init(PERIODICAL_CONFIG).catch(err => console.error('Erro durante a execução:', err));
