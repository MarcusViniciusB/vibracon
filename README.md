# Vibra — protótipo experimental 0.7.0

Aplicativo web para testar amplificação de movimento sem IA no próprio navegador. Não é um APK. A página e o worker precisam ser carregados pela rede; não há garantia de reabertura offline nesta versão. Nenhum vídeo é enviado pelo código do aplicativo.

## Versão 0.8 — trecho analisado: sugestão automática × escolha manual

- **Quantidade de quadros é do usuário.** "Sugerir trecho regular" mantém a quantidade e os FPS escolhidos e altera **apenas o início**. Entre os trechos que comportam essa quantidade sem lacunas, escolhe o de maior regularidade (menos quadros retidos e menor dispersão dos intervalos do arquivo); em empate, o mais próximo do início atual.
- **Sem trecho regular compatível:** a interface explica o motivo e o tamanho do maior trecho regular, e **nenhum parâmetro é alterado**.
- **Escolha manual:** qualquer início é aceito se o intervalo couber no vídeo. Se houver lacunas (intervalo do arquivo > 1,5 período de amostragem), aparece um aviso com a quantidade, a duração e a posição da maior lacuna, e o processamento só é liberado após a confirmação explícita "Entendo que este trecho tem lacunas…".
- **Bloqueios mantidos:** trecho além da duração do vídeo (com o início máximo possível) e amostragem acima dos intervalos usuais do arquivo.
- **Modo visível:** o bloco "Trecho analisado" mostra "Sugestão automática, baseada na temporização do arquivo" ou "Escolha manual"; qualquer edição de início, quadros ou FPS volta para manual.
- **Relatório e CSV:** `segment.choice`, `temporalCheck` (`no-gaps-in-file-timing`, `gaps-confirmed-by-user` ou `not-verified-no-timing-table`), `userConfirmedGaps`, `uniformSamplingValidated`, lista de lacunas e o instante real do quadro do arquivo usado em cada amostra (`t_quadro_arquivo_s` no CSV). Nenhum quadro intermediário é criado.
- Testes: `tests/segment.test.cjs`, mais verificação no navegador com MP4 de 120 s com lacunas em 3, 20, 51 e 90 s, e com um MP4 com lacunas a cada 3 s.

## Versão 0.7.1 — responsividade

Layout ajustado para celular (vídeos empilhados em telas até 560 px, etapas em grade), tablet (coluna única com controles em grade 2 × 2 entre 701 e 1100 px), celular deitado (introdução reduzida) e telas largas (até 1640 px). Em telas de toque, botões e campos têm 44 px e fonte de 16 px, o que evita o zoom automático do iOS. Verificado sem rolagem horizontal em 320, 375, 414, 768, 844 (deitado), 1024, 1366 e 1920 px.

## Versão 0.7 — visual claro e mais sóbrio

Tema claro (fundo cinza, painéis brancos com borda fina), tipografia IBM Plex, um único azul para ações e dados, verde só para etapas concluídas e âmbar só para os marcadores de tempo e posição. Sem brilhos, gradientes ou blocos promocionais. Textos da interface encurtados. Controles reunidos num único painel; indicador de progresso em barra simples. Os cálculos e as funções da 0.6 continuam iguais.

## Versão 0.6 — interface de inspeção (equipe OhmCinética)

Nova interface escura de nível industrial, alinhada ao Desafio Vibracon (HackatOhm CEFET), com a marca OhmCinética. O cálculo de 0.5.1 foi preservado; as mudanças são de interface e análise.

- **Narrativa e fluxo**: "A estrutura se move. Nem sempre vemos." + indicador das 4 etapas do desafio (gravar → selecionar região → filtrar frequências → amplificar e comparar), que se atualiza conforme o uso.
- **Design system** em `style.css` com variáveis CSS (cores, tipografia, espaçamento, raios); estados hover/active/disabled/busy em todos os botões; layout em grid responsivo (controles fixos à esquerda no computador; bancada primeiro no celular).
- **Indicador de processamento** sobre o painel amplificado: anel de progresso, etapa atual (leitura, rastreamento/fase, filtragem, reconstrução) e cronômetro.
- **Corte espacial λc** (modo clássico): aplica o limite de Wu et al. (2012) por pixel — onde α·|δ| > λc/8, o ganho cai para λc/(8|δ|). Ajustável sem reprocessar. Teste: `tests/lambda.test.cjs`.
- **Fatia espaço-temporal** (original × amplificado) numa linha vertical ou horizontal pelo ponto de medição, como nas figuras de Wu et al.
- **Deslocamento x(t) e espectro** no ponto de medição (modo clássico), a partir de `processed.motion`. O ponto é escolhido automaticamente (centro do grupo de nós de maior movimento com textura suficiente) ou tocando no painel amplificado.
- **Exportação CSV** com t físico, t no arquivo, dx/dy em px da prévia e px nativos. Os valores já estão filtrados na faixa; não há calibração em mm.
- Na régua virtual (grade de 256 px), o deslocamento estimado em x = 416 px foi ≈ 1,99 px, contra 1,89 px sintéticos. Na grade de 128 px o erro é maior. Isso não é validação metrológica.

Arquivos: `index.html` (estrutura), `style.css` (design system), `app.js` (orquestração), `ui.js` (fluxo, estado, indicador), `charts.js` (gráficos em canvas), `analysis.js` (fatias, x(t), espectro, CSV), `motion.js`/`engine.js`/`worker.js`/`probe.js` (cálculo), `assets/` (logo).

## Primeiro uso

1. Abra a página no Chrome do celular.
2. Toque em **Experimentar com uma régua virtual**.
3. Deixe a faixa de 2 a 6 Hz e ganho de 10×.
4. Toque em **Amplificar movimento**; aguarde sem fechar a página.
5. Reproduza a comparação. O controle de velocidade altera a reprodução, não o cálculo.
6. Depois, importe um MP4 curto, confira FPS e câmera lenta, desenhe uma região com margem e repita.

## O que está implementado

- Vídeo importado por arquivo local, com busca por instantes.
- Demonstração de régua virtual (4 Hz, deslocamento máximo de 2,4 px no canvas de 512 px).
- Contorno livre por mouse/toque; margem de 20 px no recorte e máscara suavizada.
- Banco analítico complexo multiescala: três escalas, quatro orientações; fase desembrulhada, retirada de tendência linear, filtro temporal FFT com transições cossenoidais; amplificação de fase e síntese dos incrementos.
- Processamento em Web Worker, tons de cinza, 32/64/128 quadros, 64/128/256/512 pixels.
- Comparação sincronizada com zoom do recorte, cancelamento, exportação WebM por MediaRecorder, JSON de parâmetros. Resolução padrão de 256 pixels no computador e 128 em aparelhos de toque; 512 pixels disponível para maior qualidade.

O algoritmo é uma implementação independente e experimental inspirada no princípio de Wadhwa et al. (2013), *Phase-Based Video Motion Processing*. NÃO é uma reprodução integral da pirâmide orientável complexa do artigo. Não usa rede neural, treinamento ou modelo aprendido.

## Limitações técnicas relevantes

- Ainda não testado em Galaxy M55 nem validado com acelerômetro ou vídeo experimental da régua.
- Em MP4/MOV, lê taxa média e temporização variável pela tabela stts/mdhd. Permite temporização irregular quando o trecho selecionado não cruza intervalos superiores a 1,5 vez o período de amostragem solicitado; bloqueia sobre-amostragem maior que 5% dos intervalos usuais. Pequenas diferenças de quantização não causam bloqueio global. Não detecta imagens duplicadas nem recupera a taxa de captura anterior à conversão. Arquivos não suportados exigem FPS manuais. Não usar para medição quantitativa.
- Filtragem temporal periódica e remoção de tendência introduzem erros de borda; inspecione a região central do trecho.
- O banco usa FFT espacial periódica; bordas do recorte, grandes movimentos e baixo contraste podem causar artefatos. Selecionar margens amplas ajuda, mas não elimina o problema.
- A redução espacial limita detalhes; a máscara é estática; não há estabilização de câmera.
- Atenuação de regiões de baixa amplitude protege contra fase instável, porém altera o ganho efetivo. Ganho solicitado não equivale a ganho certificado.
- Tons de cinza. Exibe a reconstrução completa no recorte, em vez de sobrepor incremento de baixa resolução sobre bordas de alta resolução (correção 0.2). A referência mantém a resolução da prévia de até 512 × 384; apenas o resultado usa a resolução escolhida. O zoom do recorte vem ativado. Valores são limitados ao intervalo da imagem.
- Exportação em tempo real, sem áudio; temporização depende do navegador. Não usar o vídeo exportado como base metrológica.
- Por enquanto não há rastreamento quantitativo, calibração em mm, espectro de deslocamento ou comparação de acelerômetro.

## Executar localmente no computador

Requer Python 3 apenas para servir os arquivos; o cálculo continua no navegador:

```
python -m http.server 8080 --directory dist
```

Abra http://localhost:8080. Não é necessário instalar pacotes JavaScript.

## Testes numéricos

Requer Node.js:

```
node tests/engine.test.cjs
node tests/probe.test.cjs
node tests/resolution.test.cjs
node tests/motion.test.cjs
node tests/lambda.test.cjs
node tests/segment.test.cjs
```

Verifica reconstrução FFT, ganho unitário, ganho dentro da faixa, rejeição de frequência fora da faixa, máscara nula e limite de Nyquist. No caso senoidal controlado (64×64, 64 quadros, 32 Hz de amostragem, sinal de 4 Hz e amplitude de 0,25 px), ganho solicitado 5× produziu aproximadamente 4,89×. Isso não é validação geral do método.

## Próxima etapa experimental

Filmar uma régua com câmera fixa, referência dimensional no plano e FPS conhecidos. Comparar primeiro frequência e depois deslocamento do vídeo ORIGINAL com aceleração medida no mesmo ponto/direção. Só após esses testes evoluir resolução, desempenho e versão Android/offline.

## Correção 0.2

Motivo: sobrepor uma diferença calculada em resolução baixa à fonte nítida deixa bordas originais paradas e halos móveis. Agora os dois painéis recebem diretamente o recorte original amostrado ou o recorte reconstruído, sem somar essa diferença à fonte nítida. Leitura de metadados evita confundir FPS do arquivo com FPS de captura. Ainda é necessário retestar o vídeo real fornecido pelo usuário.

## Versão 0.3 — seleção de trecho em arquivo irregular

A taxa média do arquivo não define um relógio uniforme. O leitor agora calcula a mediana ponderada dos intervalos (taxa usual), conserva a tabela temporal, sugere o trecho regular mais longo e valida o intervalo solicitado. A extração por seek continua sendo uma reamostragem aproximada no navegador, sem criação de quadros intermediários. Isso não substitui um decodificador científico por timestamps de apresentação e não recupera quadros ausentes.

No vídeo fornecido pelo usuário, a média é 24,444 FPS e os intervalos mais comuns estão próximos de 30 FPS; há lacunas longas, sobretudo no começo. Um trecho útil inicia aos 81 segundos. Para câmera lenta de 10× declarada pelo usuário e excitação física de 10 Hz: amostragem solicitada de 30 FPS de reprodução, fator 10×, faixa física inicial 8–12 Hz, 128 quadros (4,27 s de reprodução, 0,427 s físicos assumidos) e ganho 3–5×. O fator 10× não é confirmado pelos metadados.

A análise offline de perfis de intensidade no trecho final encontrou componente próxima de 1 Hz na reprodução, compatível com a informação do usuário. É verificação de compatibilidade, não validação metrológica. O processamento de um recorte real também foi executado; o ganho efetivo ainda não foi certificado.

## Versão 0.4 — nitidez da referência e qualidade do cálculo

O painel Original não usa mais a grade reduzida de cálculo. Ele mantém a prévia em tons de cinza de até 512 × 384 pixels. A versão anterior podia reduzir toda a imagem a aproximadamente 120 pixels de largura e ampliá-la de novo, pixelando ambos os painéis.

O cálculo agora aceita 256 e 512 pixels, além de 64 e 128. Por padrão, computadores usam 256 e aparelhos de toque 128. A opção 512 aumenta a duração e o consumo de memória; 128 quadros de 512 pixels podem exigir aproximadamente 1 GB somando intermediários e prévias, além de outros recursos do navegador. Não houve benchmark no M55. Uma região menor costuma ser a melhor forma de preservar detalhes.

Os coeficientes e espectros agora são armazenados em Float32; a trajetória de fase temporal e os filtros mantêm Float64. Reutiliza-se a memória dos coeficientes para o incremento após ler cada trajetória de fase. As entradas são transferidas ao worker em vez de copiadas. O resultado continua sendo a reconstrução completa, sem sobrepor uma diferença de baixa resolução à fonte nítida.

Mais resolução melhora a representação espacial, mas não remove automaticamente halos causados por ganho alto ou falhas do algoritmo experimental.

## Versão 0.5 — reconstrução por deslocamento clássico

Acrescenta um método diferente do módulo de fase: estima deslocamentos pequenos em relação à média temporal com a aproximação linear de Lucas–Kanade; usa gradientes espaciais de quarta ordem, normalização de brilho, regularização local, filtragem temporal por FFT e interpolação do campo numa grade. O vídeo é então reconstruído por mapeamento inverso dos pixels da prévia, com incremento (G−1) vezes o deslocamento na faixa. Não há rede neural. O modo de fase continua disponível.

O padrão passa a ser o método clássico com ganho solicitado de 50×; a faixa é 1–100× nos dois modos desde a versão 0.5.1. No modo de fase, o ganho exige novo processamento; ganhos altos podem produzir borrão e contornos duplicados. A grade escolhida limita a estimação do movimento, mas a reconstrução usa os pixels da prévia de até 512 × 384. A máscara livre controla onde o campo adicional é aplicado.

Limitações: o modelo é linearizado e supõe deslocamentos pequenos na entrada e brilho aproximadamente constante. Estimativas acima de 2,5 pixels na grade são descartadas; texturas insuficientes, reflexos, mudança de iluminação, oclusões e movimento da câmera podem invalidar a interpretação. Ele não segmenta automaticamente a régua nem subtrai movimento da câmera. Amplificações grandes de sinais maiores podem exceder o suporte espacial do campo e deformar a imagem. Ganho solicitado não é um resultado metrológico.

Referência de princípio: documentação oficial de fluxo óptico do OpenCV (https://docs.opencv.org/4.12.0/d4/dee/tutorial_optical_flow.html). Esta é uma implementação própria e simplificada da aproximação; não é o código do OpenCV nem reprodução integral de Wadhwa.

Teste controlado: faixa clara estreita com textura e oscilação de 0,2 px a 4 Hz, amostrada a 32 Hz. Com G=20, centroide da imagem reconstruída oscilou aproximadamente 4,03 px (ganho 20,16×). Verifica ainda ganho unitário, máscara nula, frequência fora da faixa e sinal de 0,05 px com G=100. Esses testes não certificam ganho em vídeos reais. O recorte real do usuário também foi processado; sua amplificação permanece experimental.

No modo clássico, o ganho pode ser alterado depois do cálculo sem repetir a extração ou o rastreamento. O relatório e a exportação usam o novo valor. No modo de fase, alterar ganho exige novo processamento.
