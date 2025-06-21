# Scraping Journals

Projeto para extração (scraping) de dados de periódicos acadêmicos brasileiros na área de Arqueologia. O objetivo é coletar informações de artigos publicados em diferentes revistas, facilitando análises e estudos posteriores.

## Revistas analisadas

- [Cadernos do Leparq](https://periodicos.ufpel.edu.br/index.php/lepaarq/issue/archive)
- [Revista de Arqueologia Pública](https://periodicos.sbu.unicamp.br/ojs/index.php/rap/issue/archive)
- [Revista Habitus](https://seer.pucgoias.edu.br/index.php/habitus/issue/archive)
- [Revista Clio](https://periodicos.ufpe.br/revistas/index.php/clioarqueologica/issue/archive)
- [Revista de Ciências Humanas do Museu Goeldi](http://editora.museu-goeldi.br/humanas/#)
- [Revista do Museu de Arqueologia e Etnologia da USP](https://revistas.usp.br/revmae/issue/archive)
- [Revista da Sociedade de Arqueologia Brasileira](https://revista.sabnet.org/ojs/index.php/sab/issue/archive)
- [Revista Vestígios](https://periodicos.ufmg.br/index.php/vestigios)

## Estrutura do projeto

- `scripts/`: Scripts de scraping para cada revista.
- `utils/`: Utilitários para manipulação de dados e conversão de formatos.
- `raw/`: Dados brutos extraídos em formato JSON.

## Como usar

1. Instale as dependências:
   ```bash
   npm install
   ```

2. Execute o script desejado, por exemplo:
   ```bash
   node scripts/arqueologia_publica.js
   ```

3. Os dados extraídos serão salvos na pasta `raw/`.

## Observações

- Cada script é específico para o formato do site de cada revista.
- Os dados podem ser convertidos em seeds para serem consumidos por aplicações Ruby on Rails por meio do seguinte comando:

```bash
  node utils/json_to_seed.js
```

