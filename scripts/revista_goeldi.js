import axios from 'axios';
import { load } from 'cheerio';
import { writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import ProgressBar from 'progress';

const __dirname = dirname(fileURLToPath(import.meta.url));

const PERIODICAL_CONFIG = {
  name: 'Boletim do Museu Paraense Emílio Goeldi. Série Ciências Humanas',
  fileName: 'revista_goeldi.json',
  archiveUrls: [
    'https://www.scielo.br/j/bgoeldi/grid',
  ],
  selectors: {
    issueSummary: '.table.table-hover .btn',
    issueTitle: 'a.title',
    issueSeries: 'div.series',
    publishedDate: '.heading .published .value',
    articleSummary: 'td.pt-4.pb-4',
    articleTitle: '.d-block.mt-2',
    doi: '.item.doi .value a',
    abstract: '.item.abstract',
    abstractLabel: 'h3.label',
  },
  keywordsRegex: /Palavras-chave:\s*([^\n]+)/i,
};

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
    let text = abstractDiv.text().replace(/\s+/g, ' ').replace(/["“”]/g, "'").trim();
    if (text.toLowerCase().startsWith('resumo ')) {
      text = text.slice(7).trim();
    }
    return text;
  }
  return '';
}

async function scrapeEditionsList(config) {
  const editionResults = await Promise.all(
    config.archiveUrls.map(async (url) => {
      let res;
      while (true) {
        try {
          res = await axios.get(url);
          if (res.status !== 200) {
            throw new Error(`Erro ao acessar a página de arquivo: ${res.status}`);
          }
          break;
        } catch (err) {
          console.error(`Erro ao acessar ${url}: ${err.message}. Tentando novamente...`);
        }
      }
      const edition = load(res.data);
      const editions = [];
      edition(config.selectors.issueSummary).each((_, el) => {
        const baseUrl = 'https://www.scielo.br';
        const link = `${baseUrl}${edition(el).attr('href')}`;
        if (link) {
          editions.push({ title: '', url: link });
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
      const baseInfos = article('.h6.fw-bold.d-block.mb-3').text().trim();
      let volume = '', numero = '', publicado = '';
      const volumeMatch = baseInfos.match(/Volume:\s*([^\s,]+)/i);
      const numeroMatch = baseInfos.match(/Número:\s*([^\s,]+)/i);
      const publicadoMatch = baseInfos.match(/Publicado:\s*([^\s,]+)/i);
      if (volumeMatch) volume = volumeMatch[1];
      if (numeroMatch) numero = numeroMatch[1];
      if (publicadoMatch) publicado = publicadoMatch[1];
      edition.date = publicado;
      edition.title = `Volume ${volume}, Número ${numero}`;
      article(config.selectors.articleSummary).each((_, el) => {
        let title = article(el).find(config.selectors.articleTitle).text().replace(/PDF/gi, '').replace(/\s+/g, ' ').trim();
        const authorsTextArray = article(el).find('.me-2').map((_, a) => article(a).text().trim()).get();

        let url = '';
        article(el).find('li.nav-item').each((_, li) => {
          const strongText = article(li).find('strong').text().trim().toLowerCase();
          if (strongText.startsWith('resumo')) {
            article(li).find('a').each((_, a) => {
              if (article(a).text().trim().toLowerCase() === 'pt') {
          url = 'https://www.scielo.br' + article(a).attr('href');
              }
            });
          }
        });

        const authors = authorsTextArray.map(author => {
          const parts = author.split(',');
          if (parts.length === 2) {
            return parts[1].trim() + ' ' + parts[0].trim();
          }
          return author.trim();
        });
        articles.push({ url, title, authors });
      });
      bar.tick();
      return {
        edition: `Volume ${volume}, Número ${numero}`,
        url: edition.url,
        date: publicado,
        articles
      };
    })
  );
  return editionResults;
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
