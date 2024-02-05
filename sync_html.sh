gitbook build
sudo rm /var/www/html/* -rf
sudo cp _book/* /var/www/html/ -rf #替换为自己的目录
sudo systemctl restart nginx.service
