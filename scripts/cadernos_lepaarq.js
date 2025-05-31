const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');

const BASE_URL = 'https://periodicos.ufpel.edu.br';
const ARCHIVE_URL = [`${BASE_URL}/index.php/lepaarq/issue/archive`, `${BASE_URL}/index.php/lepaarq/issue/archive/2`];

async function getAllEditions() {
  const allEditions = await Promise.all(
    ARCHIVE_URL.map(async url => {
      const res = await axios.get(url);

      if (res.status !== 200) {
        throw new Error(`Erro ao acessar a página de arquivo: ${res.status}`);
      }

      const $ = cheerio.load(res.data);
      const editions = [];

      $('.obj_issue_summary').each((_, el) => {
        const link = $(el).find('a.title').attr('href');
        const title = $(el).find('a.title').text().trim();
        if (link) {
          editions.push({ title, url: link });
        }
      });

      return editions;
    })
  );

  return allEditions.reduce((acc, curr) => acc.concat(curr), []);
}

async function getArticlesFromEdition(edition) {
  const res = await axios.get(edition.url);
  const $ = cheerio.load(res.data);
  const articles = [];

  $('.obj_article_summary').each((_, el) => {
    let title = $(el).find('.obj_article_summary .title a').text().replace(/PDF/gi, '').replace(/\s+/g, ' ').trim();
    const authors = [];
    const authorsText = $(el)
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

  return articles;
}

async function scrape() {
  const editions = await getAllEditions();
  const result = [];

  for (const edition of editions) {
    const articles = await getArticlesFromEdition(edition);
    result.push({
      edition: edition.title,
      url: edition.url,
      articles,
    });
  }

  const outputDir = path.join(__dirname, '../raw');
  const outputPath = path.join(outputDir, 'cadernos_lepaarq.json');
  fs.writeFileSync(outputPath, JSON.stringify(result, null, 2), 'utf8');
}

scrape().catch(err => console.error('Erro durante a execução:', err));
