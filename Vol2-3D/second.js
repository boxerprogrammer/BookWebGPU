import {mat4,vec3,quat} from './node_modules/wgpu-matrix/dist/2.x/wgpu-matrix.module.js';
//import {mat4,vec3,quat} from 'https://wgpu-matrix.org/dist/2.x/wgpu-matrix.module.js';
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

    //三角形の座標を定義
    const vertices = new Float32Array([
        //   X,    Y,   Z
        -10.0,   -8,   0.0, 
        0.0,    8,    0.0,
        10.0,    -8,   0.0
    ]
    );

    const world = mat4.translation([0,0,1]);
    //オイラー回転
    let rot = mat4.rotationY(Math.PI/3.0);
    // rot = mat4.rotateY(rot,Math.PI/4.0);
    // mat4.rotateZ(rot,Math.PI/6.0,rot);
    mat4.rotateY(world,Math.PI/3.0,world);

    //任意軸回転
    const rotAxis = mat4.axisRotation([1.0,1.0,1.0],Math.PI/3.0);
    mat4.axisRotate(rotAxis,[-1.0,0.5,0.25],Math.PI/8.0,rotAxis);

    //クオータニオンによる任意軸まわり回転
    const q = quat.fromAxisAngle([1.0,1.0,1.0],Math.PI/4.0);
    mat4.fromQuat(q,rot);

    // mat4.multiply(world,mat4.rotationY(Math.PI/4.0),world);
    // mat4.multiply(world,mat4.scaling(Math.PI/4.0),world);

    //拡大縮小
    const s = mat4.scaling([1.0,2.0,3.0]);
    mat4.scale(s,[3.0,2.0,1.0],s);

    //均等拡大縮小
    const us = mat4.uniformScaling(5.0);
    mat4.uniformScale(us,5.0,us);

    //ビュー行列を定義
    const view = mat4.lookAt([0,5,-15],[0,0,0],[0,1,0]);

    //プロジェクション行列
    const proj = mat4.perspective(Math.PI/2.0, 4.0/3.0 , 0.1, 1000.0);

    //ここまでに計算したworld,view,projectionを乗算する
    const mat = mat4.multiply(mat4.multiply(proj,view),world);
    //const mat = mat4.multiply(mat4.multiply(world,view),proj);

    //座標変換行列用バッファ
    const uniformBuffer = dev.createBuffer({
        lavel : "座標変換バッファ",
        size : mat.byteLength,
        usage : GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });

    //行列データを書き込む
    dev.queue.writeBuffer(
        uniformBuffer,//書き込み先バッファ
        0,//書き込み先オフセット
        mat.buffer,//データ元
        mat.byteOffset,//データ元オフセット
        mat.byteLength//書き込みサイズ
    );


    //上の頂点データを入れるための頂点バッファをGPU上(VRAM上)に確保する
    //https://developer.mozilla.org/en-US/docs/Web/API/GPUDevice/createBuffer
    const vertexBuffer = dev.createBuffer({
        label : "Triangle Vertices",
        size : vertices.byteLength,
        usage : GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST
    });



    //GPU上の頂点バッファに頂点データを書き込む
    //https://developer.mozilla.org/en-US/docs/Web/API/GPUQueue/writeBuffer
    //引数は、書き込み先バッファ、オフセット、データ元、データオフセット(オプション)、書き込みサイズ(オプション)
    dev.queue.writeBuffer(vertexBuffer,0,vertices);

    //VertexBufferLayoutディクショナリをここで設定しておくことで、レンダリングパイプライン
    //設定の時にlayoutを"auto"にしたときに、これに合わせてレイアウトしてくれるようになる
    //これをやらない場合は、自前でレイアウトオブジェクトを作成することになり面倒くさい。
    //https://gpuweb.github.io/gpuweb/#dictdef-gpuvertexbufferlayout
    //https://developer.mozilla.org/en-US/docs/Web/API/GPUDevice/createPipelineLayout
    const vertexBufferLayout={
        arrayStride : 12,//１頂点あたり4*3で12バイト
        attributes:[
            {
                //頂点形式https://gpuweb.github.io/gpuweb/#enumdef-gpuvertexformat を参照の事
                format : "float32x3",//今回はfloat3つ(x,y,z)ぶん
                offset : 0,//構造体の先頭からその属性までのオフセットをバイト単位で
                shaderLocation:0,//この属性に関連付けられたインデックス、@locationに対応
            }
        ]
    };

    const baseShaderModule = dev.createShaderModule({
        label:"Base Shader",//後々のデバッグで識別するためのラベル文字列
        code : `
                    struct ConstantBuffer{
                        mat : mat4x4f,
                    }
                    
                    @binding(0) @group(0) var<uniform> cbuff : ConstantBuffer;

                    @vertex
                    fn vertexMain(@location(0) pos : vec4f) -> 
                        @builtin(position) vec4f{
                            return cbuff.mat*pos;
                    }
                    
                    @fragment
                    fn fragmentMain() -> @location(0) vec4f{
                        return vec4f(1,1,0,1);
                    }
                `//シェーダコード文字列
    });


    const basePipeline = dev.createRenderPipeline({
        label : "second test pipeline",
        layout : "auto",
        vertex : {
            module : baseShaderModule,//WGSLオブジェクト
            entryPoint : "vertexMain",//頂点シェーダのエントリポイント
            buffers:[vertexBufferLayout]//buffers属性という名前なのだが、頂点レイアウトが入る
        },
        fragment:{
            module:baseShaderModule,
            entryPoint:"fragmentMain",//ピクセルシェーダのエントリポイント
            targets:[{
                format:canvasFormat//出力先のフォーマット(キャンバスのフォーマットにしておく)
            }]
        }
    });

    const bindGroup = dev.createBindGroup({
        label : "Base renderer Bind Group",
        layout : basePipeline.getBindGroupLayout(0),
        entries : [
            {
                binding:0,
                resource:{buffer:uniformBuffer}
            }
        ],
    });


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
                    
                    clearValue:{r:1.0,g:0.5,b:0.5,a:1},

                    //レンダーパスを実行した「後」のストア操作
                    storeOp : "store" // このアタッチメントのレンダーパスの値を格納
                                    //"discard"の場合はレンダーパスの結果を破棄

                }
            ]
        }
    );

    //三角形描画
    pass.setVertexBuffer(0,vertexBuffer);
    pass.setPipeline(basePipeline);
    pass.setBindGroup(0,bindGroup);
    pass.draw (vertices.length/3);

    pass.end();//レンダリングパスを終了

    const commandBuffer=encoder.finish();//コマンドエンコーダの終了(とともにコマンドバッファを生成)
    dev.queue.submit([commandBuffer]);//そのコマンドバッファをコマンドキューに乗せ、GPU側に送信する
}

main();//main関数を実行