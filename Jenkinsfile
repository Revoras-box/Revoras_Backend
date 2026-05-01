pipeline {
    agent any

    environment {
        IMAGE = "cyrossachin/revoras-backend"
        CONTAINER = "revoras-backend"
    }

    stages {
        stage('Checkout') {
            steps {
                git branch: 'main', url: 'https://github.com/Revoras-box/Revoras_Backend.git'
            }
        }

        stage('Build Image') {
            steps {
                sh 'docker build -t $IMAGE:$BUILD_NUMBER -t $IMAGE:latest .'
            }
        }

        stage('Push to DockerHub') {
            steps {
                withCredentials([usernamePassword(
                    credentialsId: 'dockerhub-creds',
                    usernameVariable: 'DOCKER_USER',
                    passwordVariable: 'DOCKER_PASS'
                )]) {
                    sh 'echo $DOCKER_PASS | docker login -u $DOCKER_USER --password-stdin'
                    sh 'docker push $IMAGE:$BUILD_NUMBER'
                    sh 'docker push $IMAGE:latest'
                }
            }
        }

        stage('Deploy') {
            steps {
                sh '''
                    docker stop $CONTAINER || true
                    docker rm -f $CONTAINER || true
                    docker ps -q --filter "publish=5000" | xargs -r docker rm -f || true
                    sleep 2
                    docker pull $IMAGE:latest
                    docker run -d \
                        --name $CONTAINER \
                        --restart always \
                        -p 5000:5000 \
                        --env-file /opt/revoras/backend/.env \
                        -v /opt/revoras/uploads:/app/uploads \
                        $IMAGE:latest
                '''
            }
        }
    }

    post {
        failure {
            echo 'Backend build failed!'
        }
    }
}