# Orientação para extrair deslocamento ao longo do tempo

Código-fonte do Vibra 0.5.1, exportado do commit SHA: 384dc76fc26c66b7efebde9d37e17c620a5b412b.
HTML, CSS e JavaScript sem etapa de compilação e sem dependências JavaScript externas.

## Executar
Na pasta do projeto: python -m http.server 8080 --directory dist
Abra http://localhost:8080. Não abra index.html diretamente por file://, pois o Web Worker exige servidor.
Os testes em tests/ usam Node.js; consulte README.md.

## Mapa do código
- dist/app.js: importação, busca de quadros, seleção livre, amostragem do recorte, parâmetros e exibição.
- dist/probe.js: temporização MP4/MOV e sugestão de trecho regular.
- dist/worker.js: recebe quadros e parâmetros e executa o método selecionado.
- dist/motion.js: método clássico. VibraMotion.estimate retorna campo de deslocamentos; warp reconstrói a imagem amplificada; component interpola um componente do campo.
- dist/engine.js: método experimental de fase com filtros complexos e FFT. Retorna imagens reconstruídas, sem exportar uma trajetória x(t).

## Onde aproveitar os deslocamentos existentes
No método clássico, o worker retorna motion com n, t, gw, gh, step, dx, dy e confidence. Os arrays dx e dy já passaram pela filtragem temporal na faixa selecionada e suavização espacial; NÃO representam deslocamento bruto de banda completa.
São deslocamentos estimados em pixels da grade n × n, antes da aplicação do ganho visual.
Para quadro k e nó j: dx[k * gw * gh + j] e dy[k * gw * gh + j]. confidence[j] é um peso heurístico de textura, não uma incerteza metrológica.
Para amostrar uma posição da grade: VibraMotion.component(motion, k, px, py, 'dx') (ou 'dy').
No app, o resultado fica em processed.motion, e meta contém roi, dimensions, samplingFps, slowMotionFactor e startSeconds.
A conversão para pixels da prévia usa roi.w / dimensions.w em x e roi.h / dimensions.h em y. A prévia é de 512 × 384 com ajuste do enquadramento; não confundir seus pixels com pixels nativos do arquivo.
Para tempo físico relativo ao início do trecho: t_k = k / (samplingFps * slowMotionFactor), condicionado à correção desses parâmetros. O tempo no arquivo é startSeconds + k / samplingFps.

## O que ainda precisa ser implementado para x(t)
Selecionar um ponto/material ou uma região representativa na régua, definir a direção medida, exportar t, dx e dy em CSV e calibrar pixels para mm com uma referência no mesmo plano. O campo é espacial (Euleriano); consultar uma posição fixa não equivale automaticamente a seguir um ponto material. Para deslocamento bruto, preservar os vetores antes da filtragem temporal em estimate. Não obter medições a partir do vídeo amplificado exportado.
No método de fase, não existe uma trajetória de deslocamento pronta: fases locais de diferentes orientações/escalas precisam de conversão e combinação próprias; o banco atual é experimental e não reproduz integralmente a pirâmide do artigo de Wadhwa.
Comparar frequência, amplitude e fase com o acelerômetro no mesmo ponto/direção exige aquisição compatível e sincronização. A aplicação ainda não faz essa validação.
Câmera em movimento, iluminação, reflexos, baixa textura, descarte de estimativas e reamostragem aproximada por seek podem distorcer o resultado. confidence não resolve esses problemas. Não assumir que o ganho solicitado é o ganho medido.

O ZIP contém todos os arquivos da aplicação e seus testes. Não inclui vídeos pessoais, PDFs de terceiros, histórico Git, credenciais ou configuração interna da hospedagem. Para uso local, a configuração de hospedagem não é necessária.
