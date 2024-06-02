
async function main(){

    //WebGPUのグラフィクスを書き出すためのキャンバスの取得
    const canvas=document.querySelector("canvas");
    
    //アダプターとデバイスをリクエストする
    //WebGPUのためのインターフェースを取得
    if(!navigator.gpu){
        //ブラウザがWebGPUに対応してなければ例外発生
        throw new Error("WebGPUはこのブラウザでサポートされていません");
    }
    //アダプターのリクエスト
    //requestAdapterはPromiseで返ってくるため、awaitで待っておく
    //https://developer.mozilla.org/en-US/docs/Web/API/GPU/requestAdapter
    const adapter = await navigator.gpu.requestAdapter();
    if(!adapter){
        throw new Error("適切なGPUアダプタ(対応グラボ)がありません");
    }
    
    //デバイスのリクエスト
    //https://developer.mozilla.org/en-US/docs/Web/API/GPUAdapter/requestDevice
    const dev = await adapter.requestDevice();
    if(!dev){
        throw new Error("デバイスの取得に失敗しました");
    }

    //ここでWebGPU用のコンテキストを取得する
    const context=canvas.getContext("webgpu");
    //現在のGPUキャンバスにとって最適なフォーマットを返す
    //https://developer.mozilla.org/en-US/docs/Web/API/GPU/getPreferredCanvasFormat
    const canvasFormat = navigator.gpu.getPreferredCanvasFormat();


    //さて、この得られたデバイスとブラウザのキャンバスフォーマットを用いて
    ///WebGPUレンダリングに必要な設定を行います。
    //https://developer.mozilla.org/en-US/docs/Web/API/GPUCanvasContext/configure
    context.configure(
        {
            device : dev,
            format : canvasFormat
        }
    );

    //コマンドエンコーダの作成(DirectX12でいうCommandQueue+CommandList的なモノ)
    //https://developer.mozilla.org/en-US/docs/Web/API/GPUDevice/createCommandEncoder
    const encoder=dev.createCommandEncoder();

    //描画パス
    const pass = encoder.beginRenderPass(
        {
            colorAttachments:[
                {
                    //このカラーアタッチメントの出力先がviewにあたる
                    //これは恐らく現在のバックバッファやろなぁ
                    view : context.getCurrentTexture().createView(),
                    //レンダーパスを実行する「前」のロード操作
                    loadOp : "clear",//このアタッチメントのクリア値をレンダーパスにロード
                                    //"load"だったら既存の値をロード
                                    //=レンダリングパスの開始時にテクスチャをクリア

                    
                    clearValue:{r:1,g:0,b:0,a:1},

                    //レンダーパスを実行した「後」のストア操作
                    storeOp : "store" // このアタッチメントのレンダーパスの値を格納
                                    //"discard"の場合はレンダーパスの結果を破棄
                                    //=レンダリングパスが終了するとレンダリングパス中二行われた描画の結果をテクスチャに保存

                }
            ]
        }
    );

    pass.end();//レンダリングパスを終了

    const commandBuffer=encoder.finish();//コマンドエンコーダの終了(とともにコマンドバッファを生成)
    dev.queue.submit([commandBuffer]);//そのコマンドバッファをコマンドキューに乗せ、GPU側に送信する
                                        //なお、この関数自体は複数のコマンドバッファを想定しているため
                                        //配列(コレクション)として送信する必要がある
}

main();//main関数を実行