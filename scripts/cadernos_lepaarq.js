import axios from 'axios';
import { load } from 'cheerio';
import { writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import ProgressBar from 'progress';

const __dirname = dirname(fileURLToPath(import.meta.url));

const BASE_URL = 'https://periodicos.ufpel.edu.br';
const ARCHIVE_URL = [`${BASE_URL}/index.php/lepaarq/issue/archive`, `${BASE_URL}/index.php/lepaarq/issue/archive/2`];

async function scrapeEditionsList() {
  const allEditions = [];
  for (const url of ARCHIVE_URL) {
    const res = await axios.get(url);

    if (res.status !== 200) {
      throw new Error(`Erro ao acessar a página de arquivo: ${res.status}`);
    }

    const edition = load(res.data);
    const editions = [];

    edition('.obj_issue_summary').each((_, el) => {
      const link = edition(el).find('a.title').attr('href');
      const title = edition(el).find('a.title').text().trim();
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
    edition.date = article('.heading .published .value').text().trim();

    article('.obj_article_summary').each((_, el) => {
      let title = article(el).find('.obj_article_summary .title a').text().replace(/PDF/gi, '').replace(/\s+/g, ' ').trim();
      const authors = [];
      const authorsText = article(el)
        .find('.obj_article_summary .meta .authors')
        .text();

      let splitAuthors;
      if (authorsText.includes(';')) {
        splitAuthors = authorsText.split(';');
      } else {
        splitAuthors = authorsText.split(',');
      }

      splitAuthors.forEach(name => {
        const clean = name.replace(/\s+/g, ' ').trim();
        if (clean) authors.push(clean);
      });

      articles.push({ title, authors });
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

async function init() {
  const editions = await scrapeEditionsList();
  const editionPagesinformation = await scrapEditionPages(editions);

  writeFile(editionPagesinformation, 'cadernos_lepaarq.json');
}

init().catch(err => console.error('Erro durante a execução:', err));
