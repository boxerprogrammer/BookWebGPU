import {mat4,vec3,vec4,quat} from './node_modules/wgpu-matrix/dist/2.x/wgpu-matrix.module.js';
import {uploadGLBModel} from './glb_import.js';
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

    //GLBファイルのロード
    const glbFile = await fetch("./tsuchinoko.glb").then(
                            res => res.arrayBuffer().then(
                                buf => uploadGLBModel(buf, dev)
                            )
                        );
    
    console.log("nodes=" + glbFile.nodes.length+"\n");
    console.log("node0.name=" + glbFile.nodes[0].name+"\n");
    console.log("node0.primitives=" + glbFile.nodes[0].mesh.primitives.length+"\n");

    let vertexNum=0;
    let indexNum=0;
    for(let i=0;i<glbFile.nodes.length;++i){
        for(let j=0;j<glbFile.nodes[i].mesh.primitives.length;++j){
            vertexNum+= glbFile.nodes[i].mesh.primitives[j].positions.count;
            indexNum+= glbFile.nodes[i].mesh.primitives[j].indices.count;
        }
    }


    
    

    //ここでWebGPU用のコンテキストを取得する
    const context=canvas.getContext("webgpu");
    //現在のGPUキャンバスにとって最適なフォーマットを返す
    //https://developer.mozilla.org/en-US/docs/Web/API/GPU/getPreferredCanvasFormat
    const canvasFormat = navigator.gpu.getPreferredCanvasFormat();


    const world = mat4.translation([0,0,1]);
    //オイラー回転
    let rot = mat4.rotationY(Math.PI/3.0);
    // rot = mat4.rotateY(rot,Math.PI/4.0);
    // mat4.rotateZ(rot,Math.PI/6.0,rot);
    mat4.rotateY(world,Math.PI/3.0,world);

    // mat4.multiply(world,mat4.rotationY(Math.PI/4.0),world);
    // mat4.multiply(world,mat4.scaling(Math.PI/4.0),world);

    //均等拡大縮小
    mat4.uniformScale(world,80.0,world);

    //ビュー行列を定義
    const view = mat4.lookAt([0,0,-15],[0,0,0],[0,1,0]);

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

    
    const vertexBuffer = dev.createBuffer({
        label : "Tsuchinoko Vertices",
        size : vertexNum*3*4,
        usage : GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST
    });

    //インデックスバッファをGPU上に確保する
    const indexBuffer = dev.createBuffer({
        label : "Tsuchinoko Indices",
        size : indexNum*2,
        usage : GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST
    });

    let offset=0;
    for(let i=0;i<glbFile.nodes.length;++i){
        const node=glbFile.nodes[i];
        for(let j=0;j<node.mesh.primitives.length;++j){
            const prim = node.mesh.primitives[j];
            const view = prim.positions.view;//実データはviewの中にあるbuffer
            const buffer=view.buffer;//実データ
            const size=view.length;//実データのバイトサイズ
            dev.queue.writeBuffer(vertexBuffer,offset,buffer);//書き込み
            offset+=size;//複数あるためオフセットさせながら書き込んでいきます
        }
    }

    
    let indices = new Uint16Array(indexNum);
    let startIdx=0;
    let currentIdx=0;
    for(let i=0;i<glbFile.nodes.length;++i){
        const node=glbFile.nodes[i];
        for(let j=0;j<node.mesh.primitives.length;++j){
            const prim = node.mesh.primitives[j];
            const posCount = prim.positions.count;
            const idxAccess = prim.indices;
            const arr16 = new Uint16Array(idxAccess.view.buffer.buffer,
                    idxAccess.view.byteOffset,
                    idxAccess.count
            );
            for(let k=0;k<idxAccess.count;++k){
                indices[currentIdx] = arr16[k]+startIdx;
                ++currentIdx;
            }
            startIdx+=posCount;
        }
    }

    dev.queue.writeBuffer(indexBuffer,0,indices);//書き込み


    

    // dev.queue.writeBuffer(indexBuffer,0,indices);

    const vertexBufferLayout={
        arrayStride : 12,//１頂点あたり4*3で12バイト
        attributes:[
            //頂点座標
            {
                //頂点形式https://gpuweb.github.io/gpuweb/#enumdef-gpuvertexformat を参照の事
                format : "float32x3",//今回はfloat3つ(x,y,z)ぶん
                offset : 0,//構造体の先頭からその属性までのオフセットをバイト単位で
                shaderLocation:0,//この属性に関連付けられたインデックス、@locationに対応
            },

            // {//UV座標
            //     format : "float32x2",//今回はfloat2つ(x,y)ぶん
            //     offset : 12,//構造体の先頭からその属性までのオフセットをバイト単位で
            //     shaderLocation:1,// @location(n)に対応
            // }

        ]
    };


    //画像データのロード
    const image=new Image();
    image.src="./nekodot.png";
    await image.decode();
    const bitmap=await createImageBitmap(image);
    //VRAMにテクスチャ領域を確保
    const texture = dev.createTexture({
        size:[bitmap.width,bitmap.height,1],//最後の1はテクスチャ配列数
        format:"rgba8unorm",//フォーマット(RGBA8ビットを正規化)
        usage:GPUTextureUsage.TEXTURE_BINDING | //テクスチャとして
                GPUTextureUsage.COPY_DST | //コピー先として
                GPUTextureUsage.RENDER_ATTACHMENT //レンダリング時に使う
    });
    //GPU側へ画像データを転送
    dev.queue.copyExternalImageToTexture(
        {source:bitmap},//元データ
        {texture:texture},//書き込み先テクスチャ
        [bitmap.width,bitmap.height]//書きこみサイズ
    );

    //サンプラの作成
    const sampler = dev.createSampler({
        addressModeU: "repeat",//UV値が1を越えたら繰り返し
        addressModeV: "repeat",//UV値が1を越えたら繰り返し
        magFilter: "linear",//拡大時に線形補間
        minFilter: "linear"//縮小時に線形補間
    });

    const baseShaderModule = dev.createShaderModule({
        label:"Base Shader",//後々のデバッグで識別するためのラベル文字列
        code : `
                    struct ConstantBuffer{
                        mat : mat4x4f,
                    }
                    
                    @group(0) @binding(0) var<uniform> cbuff : ConstantBuffer;
                    // @group(0) @binding(1) var smp: sampler;
                    // @group(0) @binding(2) var tex: texture_2d<f32>;	
    
                    struct VertexOutput{
                        @builtin(position) pos: vec4f,
                        //@location(0) uv: vec2f
                    };
    
                    @vertex
                    fn vertexMain(@location(0) pos : vec4f) -> VertexOutput{
                        var out : VertexOutput;
                        out.pos = cbuff.mat*pos;
                        //out.uv = uv;
                        return out;
                    }
                    
                    @fragment
                    fn fragmentMain(in:VertexOutput) -> @location(0) vec4f{
                        //let  col :vec4f= textureSample(tex,smp,in.uv);
                        return vec4f(0,0,0,1);
                    }
                `//シェーダコード文字列
    });


    const basePipeline = dev.createRenderPipeline({
        label : "Tsuchinoko Pipeline",
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
        },
        primitive:{
            cullMode:'back',
            topology: 'triangle-list',
        }
    });

    const bindGroup = dev.createBindGroup({
        label : "Base renderer Bind Group",
        layout : basePipeline.getBindGroupLayout(0),
        entries : [
            //定数バッファ:0
            {
                binding:0,
                resource:{buffer:uniformBuffer}
            },
            // {//サンプラ:1
            //     binding:1,
            //     resource:sampler
            // },
            // {//テクスチャ:2
            //     binding:2,
            //     resource:texture.createView()
            // },
        ],
    });

    ///WebGPUレンダリングに必要な設定を行います。
    context.configure(
        {
            device : dev,
            format : canvasFormat
        }
    );

    setInterval(updateFrame,16);

    function updateFrame(){
        mat4.rotateY(world,Math.PI/180.0,world);
        const mat = mat4.multiply(mat4.multiply(proj,view),world);
        //行列データを書き込む
        dev.queue.writeBuffer(
            uniformBuffer,//書き込み先バッファ
            0,//書き込み先オフセット
            mat.buffer,//データ元
            mat.byteOffset,//データ元オフセット
            mat.byteLength//書き込みサイズ
        );

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

        pass.setVertexBuffer(0,vertexBuffer);
        pass.setIndexBuffer(indexBuffer,'uint16');
        pass.setPipeline(basePipeline);
        pass.setBindGroup(0,bindGroup);
        //pass.draw (vertexNum);
        pass.drawIndexed (indexNum);

        pass.end();//レンダリングパスを終了

        const commandBuffer=encoder.finish();//コマンドエンコーダの終了(とともにコマンドバッファを生成)
        dev.queue.submit([commandBuffer]);//そのコマンドバッファをコマンドキューに乗せ、GPU側に送信する
    }
}

main();//main関数を実行